import {createDOMException} from './DOMException.js';
import CFG from './CFG.js';
import CY from 'cyclonejs';

let cleanInterface = false;

const testObject = {test: true};
// Test whether Object.defineProperty really works.
if (Object.defineProperty) {
    try {
        Object.defineProperty(testObject, 'test', { enumerable: false });
        if (testObject.test) {
            cleanInterface = true;
        }
    } catch (e) {
    // Object.defineProperty does not work as intended.
    }
}

/**
 * Shim the DOMStringList object.
 *
 */
const StringList = function () {
    this.length = 0;
    this._items = [];
    // Internal functions on the prototype have been made non-enumerable below.
    if (cleanInterface) {
        Object.defineProperties(this, {
            '_items': {
                enumerable: false
            },
            'length': {
                enumerable: false
            }
        });
    }
};
StringList.prototype = {
    // Interface.
    contains: function (str) {
        return this._items.includes(str);
    },
    item: function (key) {
        return this._items[key];
    },

    // Helpers. Should only be used internally.
    clone: function () {
        const stringList = new StringList();
        stringList._items = this._items.slice();
        stringList.length = this.length;
        stringList.addIndexes();
        return stringList;
    },
    addIndexes: function () {
        for (let i = 0; i < this._items.length; i++) {
            this[i] = this._items[i];
        }
    },
    sortList: function () {
        // http://w3c.github.io/IndexedDB/#sorted-list
        // https://tc39.github.io/ecma262/#sec-abstract-relational-comparison
        this._items.sort();
        this.addIndexes();
        return this._items;
    },
    forEach: function (cb, thisArg) {
        this._items.forEach(cb, thisArg);
    },
    map: function (cb, thisArg) {
        return this._items.map(cb, thisArg);
    },
    indexOf: function (str) {
        return this._items.indexOf(str);
    },
    push: function (item) {
        this._items.push(item);
        this.length++;
        this.sortList();
    },
    splice: function (...args /* index, howmany, item1, ..., itemX */) {
        this._items.splice(...args);
        this.length = this._items.length;
        for (const i in this) {
            if (i === String(parseInt(i, 10))) {
                delete this[i];
            }
        }
        this.sortList();
    }
};
if (cleanInterface) {
    for (const i in {
        'addIndexes': false,
        'sortList': false,
        'forEach': false,
        'map': false,
        'indexOf': false,
        'push': false,
        'splice': false
    }) {
        Object.defineProperty(StringList.prototype, i, {
            enumerable: false
        });
    }
}

function escapeNameForSQLiteIdentifier (arg) {
    // http://stackoverflow.com/a/6701665/271577
    return '_' + // Prevent empty string
        arg.replace(/\^/g, '^^') // Escape our escape
        // http://www.sqlite.org/src/tktview?name=57c971fc74
        .replace(/\0/g, '^0')
        // We need to avoid identifiers being treated as duplicates based on SQLite's ASCII-only case-insensitive table and column names
        // (For SQL in general, however, see http://stackoverflow.com/a/17215009/271577
        // See also https://www.sqlite.org/faq.html#q18 re: Unicode (non-ASCII) case-insensitive not working
        .replace(/([A-Z])/g, '^$1')
        // http://stackoverflow.com/a/6701665/271577
        .replace(/([\uD800-\uDBFF])(?![\uDC00-\uDFFF])|(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, function (_, unmatchedHighSurrogate, unmatchedLowSurrogate) {
            if (unmatchedHighSurrogate) {
                return '^2' + unmatchedHighSurrogate + '\uDC00'; // Add a low surrogate for compatibility with `node-sqlite3`: http://bugs.python.org/issue12569 and http://stackoverflow.com/a/6701665/271577
            }
            return '^3\uD800' + unmatchedLowSurrogate;
        });
}

function escapeNUL (arg) {
    return arg.replace(/\^/g, '^^').replace(/\0/g, '^0');
}
function unescapeNUL (arg) {
    return arg.replace(/^0/g, '\0').replace(/\^\^/g, '^');
}

function sqlEscape (arg) {
    // https://www.sqlite.org/lang_keywords.html
    // http://stackoverflow.com/a/6701665/271577
    // There is no need to escape ', `, or [], as
    //   we should always be within double quotes
    // NUL should have already been stripped
    return arg.replace(/"/g, '""');
}

function quote (arg) {
    return '"' + sqlEscape(arg) + '"';
}

function escapeDatabaseName (db) {
    if (CFG.escapeDatabaseName) {
        // We at least ensure NUL is escaped by default, but we need to still
        //   handle empty string and possibly also length (potentially
        //   throwing if too long), escaping casing (including Unicode?),
        //   and escaping special characters depending on file system
        return CFG.escapeDatabaseName(escapeNUL(db));
    }
    db = 'D' + escapeNameForSQLiteIdentifier(db);
    if (CFG.databaseCharacterEscapeList !== false) {
        db = db.replace(
            (CFG.databaseCharacterEscapeList
                ? new RegExp(CFG.databaseCharacterEscapeList, 'g')
                : /[\u0000-\u001F\u007F"*/:<>?\\|]/g),
            function (n0) {
                return '^1' + n0.charCodeAt().toString(16).padStart(2, '0');
            }
        );
    }
    if (CFG.databaseNameLengthLimit !== false &&
        db.length >= (CFG.databaseNameLengthLimit || 254)) {
        throw new Error(
            'Unexpectedly long database name supplied; length limit required for Node compatibility; passed length: ' +
            db.length + '; length limit setting: ' + (CFG.databaseNameLengthLimit || 254) + '.');
    }
    return db; // Shouldn't have quoting (do we even need NUL/case escaping here?)
}

// Not in use internally but supplied for convenience
function unescapeDatabaseName (db) {
    if (CFG.unescapeDatabaseName) {
        // We at least ensure NUL is unescaped by default, but we need to still
        //   handle empty string and possibly also length (potentially
        //   throwing if too long), unescaping casing (including Unicode?),
        //   and unescaping special characters depending on file system
        return CFG.unescapeDatabaseName(unescapeNUL(db));
    }

    return db.slice(2) // D_
        .replace(/(\^+)1([0-9a-f]{2})/g, (_, esc, hex) => esc % 2 ? String.fromCharCode(parseInt(hex, 16)) : _) // databaseCharacterEscapeList
        .replace(/(\^+)3\uD800([\uDC00-\uDFFF])/g, (_, esc, lowSurr) => esc % 2 ? lowSurr : _)
        .replace(/(\^+)2([\uD800-\uDBFF])\uDC00/g, (_, esc, highSurr) => esc % 2 ? highSurr : _)
        .replace(/(\^+)([A-Z])/g, (_, esc, upperCase) => esc % 2 ? upperCase : _)
        .replace(/(\^+)0/g, (_, esc) => esc % 2 ? '\0' : _)
        .replace(/\^\^/g, '^');
}

function escapeStore (store) {
    return quote('S' + escapeNameForSQLiteIdentifier(store));
}

function escapeIndex (index) {
    return quote('I' + escapeNameForSQLiteIdentifier(index));
}

function escapeIndexName (index) {
    return 'I' + escapeNameForSQLiteIdentifier(index);
}

function sqlLIKEEscape (str) {
    // https://www.sqlite.org/lang_expr.html#like
    return sqlEscape(str).replace(/\^/g, '^^');
}

// Babel doesn't seem to provide a means of using the `instanceof` operator with Symbol.hasInstance (yet?)
function instanceOf (obj, Clss) {
    return Clss[Symbol.hasInstance](obj);
}

function isObj (obj) {
    return obj && typeof obj === 'object';
}

function isDate (obj) {
    return isObj(obj) && typeof obj.getDate === 'function';
}

function isBlob (obj) {
    return isObj(obj) && typeof obj.size === 'number' && typeof obj.slice === 'function';
}

function isRegExp (obj) {
    return isObj(obj) && typeof obj.flags === 'string' && typeof obj.exec === 'function';
}

function isFile (obj) {
    return isObj(obj) && typeof obj.name === 'string' && isBlob(obj);
}

/*
// Todo: Uncomment and use with ArrayBuffer encoding/decoding when ready
function isArrayBufferOrView (obj) {
    return isObj(obj) && typeof obj.byteLength === 'number' && (
        typeof obj.slice === 'function' || // `TypedArray` (view on buffer) or `ArrayBuffer`
        typeof obj.getFloat64 === 'function' // `DataView` (view on buffer)
    );
}
*/

function isNotClonable (value) {
    try {
        CY.clone(value);
        return false;
    } catch (err) {
        return true;
    }
}

function throwIfNotClonable (value, errMsg) {
    if (isNotClonable(value)) {
        throw createDOMException('DataCloneError', errMsg);
    }
}

function defineReadonlyProperties (obj, props) {
    props = typeof props === 'string' ? [props] : props;
    props.forEach(function (prop) {
        Object.defineProperty(obj, '__' + prop, {
            enumerable: false,
            configurable: false,
            writable: true
        });
        Object.defineProperty(obj, prop, {
            enumerable: true,
            configurable: true,
            get: function () {
                return this['__' + prop];
            }
        });
    });
}

const HexDigit = '[0-9a-fA-F]';
// The commented out line below is technically the grammar, with a SyntaxError
//   to occur if larger than U+10FFFF, but we will prevent the error by
//   establishing the limit in regular expressions
// const HexDigits = HexDigit + HexDigit + '*';
const HexDigits = '0*(?:' + HexDigit + '{1,5}|10' + HexDigit + '{4})*';
const UnicodeEscapeSequence = '(?:u' + HexDigit + '{4}|u{' + HexDigits + '})';

function isIdentifier (item) {
    // For load-time and run-time performance, we don't provide the complete regular
    //   expression for identifiers, but these can be passed in, using the expressions
    //   found at https://gist.github.com/brettz9/b4cd6821d990daa023b2e604de371407
    // ID_Start (includes Other_ID_Start)
    const UnicodeIDStart = CFG.UnicodeIDStart || '[$A-Z_a-z]';
    // ID_Continue (includes Other_ID_Continue)
    const UnicodeIDContinue = CFG.UnicodeIDContinue || '[$0-9A-Z_a-z]';
    const IdentifierStart = '(?:' + UnicodeIDStart + '|[$_]|\\\\' + UnicodeEscapeSequence + ')';
    const IdentifierPart = '(?:' + UnicodeIDContinue + '|[$_]|\\\\' + UnicodeEscapeSequence + '|\\u200C|\\u200D)';
    return (new RegExp('^' + IdentifierStart + IdentifierPart + '*$')).test(item);
}

function isValidKeyPathString (keyPathString) {
    return typeof keyPathString === 'string' &&
        (keyPathString === '' || isIdentifier(keyPathString) || keyPathString.split('.').every(isIdentifier));
}

function isValidKeyPath (keyPath) {
    return isValidKeyPathString(keyPath) || (
        Array.isArray(keyPath) && keyPath.length &&
            // Convert array from sparse to dense http://www.2ality.com/2012/06/dense-arrays.html
            Array.apply(null, keyPath).every(function (kpp) {
                // If W3C tests are accurate, it appears sequence<DOMString> implies `toString()`
                // See also https://heycam.github.io/webidl/#idl-DOMString
                return isValidKeyPathString(kpp.toString());
            })
    );
}

export {StringList, escapeNUL, unescapeNUL, quote,
    escapeDatabaseName, unescapeDatabaseName,
    escapeStore, escapeIndex, escapeIndexName,
    sqlLIKEEscape, instanceOf,
    isObj, isDate, isBlob, isRegExp, isFile, throwIfNotClonable,
    defineReadonlyProperties, isValidKeyPath};
