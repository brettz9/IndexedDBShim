import {createDOMException} from './DOMException';
import {createEvent} from './Event';
import * as util from './util';
import DOMStringList from './DOMStringList';
import IDBObjectStore from './IDBObjectStore';
import IDBTransaction from './IDBTransaction';
import * as Sca from './Sca';
import CFG from './CFG';
import {EventTargetFactory} from 'eventtarget';

const listeners = ['onabort', 'onclose', 'onerror', 'onversionchange'];
const readonlyProperties = ['name', 'version', 'objectStoreNames'];

/**
 * IDB Database Object
 * http://dvcs.w3.org/hg/IndexedDB/raw-file/tip/Overview.html#database-interface
 * @constructor
 */
function IDBDatabase () {
    throw new TypeError('Illegal constructor');
}
const IDBDatabaseAlias = IDBDatabase;
IDBDatabase.__createInstance = function (db, name, oldVersion, version, storeProperties) {
    function IDBDatabase () {
        this[Symbol.toStringTag] = 'IDBDatabase';
        util.defineReadonlyProperties(this, readonlyProperties);
        this.__db = db;
        this.__closed = false;
        this.__oldVersion = oldVersion;
        this.__version = version;
        this.__name = name;
        listeners.forEach((listener) => {
            Object.defineProperty(this, listener, {
                enumerable: true,
                configurable: true,
                get: function () {
                    return this['__' + listener];
                },
                set: function (val) {
                    this['__' + listener] = val;
                }
            });
        });
        listeners.forEach((l) => {
            this[l] = null;
        });

        this.__transactions = [];
        this.__objectStores = {};
        this.__objectStoreNames = DOMStringList.__createInstance();
        const itemCopy = {};
        for (let i = 0; i < storeProperties.rows.length; i++) {
            const item = storeProperties.rows.item(i);
            // Safari implements `item` getter return object's properties
            //  as readonly, so we copy all its properties (except our
            //  custom `currNum` which we don't need) onto a new object
            itemCopy.name = item.name;
            itemCopy.keyPath = Sca.decode(item.keyPath);
            ['autoInc', 'indexList'].forEach(function (prop) {
                itemCopy[prop] = JSON.parse(item[prop]);
            });
            itemCopy.idbdb = this;
            const store = IDBObjectStore.__createInstance(itemCopy);
            this.__objectStores[store.name] = store;
            this.objectStoreNames.push(store.name);
        }
        this.__oldObjectStoreNames = this.objectStoreNames.clone();
    }
    IDBDatabase.prototype = IDBDatabaseAlias.prototype;
    return new IDBDatabase();
};

IDBDatabase.prototype = EventTargetFactory.createInstance();
IDBDatabase.prototype[Symbol.toStringTag] = 'IDBDatabasePrototype';

/**
 * Creates a new object store.
 * @param {string} storeName
 * @param {object} [createOptions]
 * @returns {IDBObjectStore}
 */
IDBDatabase.prototype.createObjectStore = function (storeName /* , createOptions */) {
    let createOptions = arguments[1];
    storeName = String(storeName); // W3C test within IDBObjectStore.js seems to accept string conversion
    if (!(this instanceof IDBDatabase)) {
        throw new TypeError('Illegal invocation');
    }
    if (arguments.length === 0) {
        throw new TypeError('No object store name was specified');
    }
    IDBTransaction.__assertVersionChange(this.__versionTransaction); // this.__versionTransaction may not exist if called mistakenly by user in onsuccess
    IDBTransaction.__assertNotFinished(this.__versionTransaction);
    IDBTransaction.__assertActive(this.__versionTransaction);

    createOptions = Object.assign({}, createOptions);
    let keyPath = createOptions.keyPath;
    keyPath = keyPath === undefined ? null : keyPath = util.convertToSequenceDOMString(keyPath);
    if (keyPath !== null && !util.isValidKeyPath(keyPath)) {
        throw createDOMException('SyntaxError', 'The keyPath argument contains an invalid key path.');
    }

    if (this.__objectStores[storeName]) {
        throw createDOMException('ConstraintError', 'Object store "' + storeName + '" already exists in ' + this.name);
    }

    const autoIncrement = createOptions.autoIncrement;
    if (autoIncrement && (keyPath === '' || Array.isArray(keyPath))) {
        throw createDOMException('InvalidAccessError', 'With autoIncrement set, the keyPath argument must not be an array or empty string.');
    }

    /** @name IDBObjectStoreProperties **/
    const storeProperties = {
        name: storeName,
        keyPath: keyPath,
        autoInc: autoIncrement,
        indexList: {},
        idbdb: this
    };
    const store = IDBObjectStore.__createInstance(storeProperties, this.__versionTransaction);
    IDBObjectStore.__createObjectStore(this, store);
    return store;
};

/**
 * Deletes an object store.
 * @param {string} storeName
 */
IDBDatabase.prototype.deleteObjectStore = function (storeName) {
    if (!(this instanceof IDBDatabase)) {
        throw new TypeError('Illegal invocation');
    }
    if (arguments.length === 0) {
        throw new TypeError('No object store name was specified');
    }
    IDBTransaction.__assertVersionChange(this.__versionTransaction);
    IDBTransaction.__assertNotFinished(this.__versionTransaction);
    IDBTransaction.__assertActive(this.__versionTransaction);

    const store = this.__objectStores[storeName];
    if (!store) {
        throw createDOMException('NotFoundError', 'Object store "' + storeName + '" does not exist in ' + this.name);
    }

    IDBObjectStore.__deleteObjectStore(this, store);
};

IDBDatabase.prototype.close = function () {
    const me = this;
    if (!(me instanceof IDBDatabase)) {
        throw new TypeError('Illegal invocation');
    }
    let erred = false;
    let ct = 0;
    function checkClosed () {
        if (!erred && ct === me.__transactions.length) {
            if (me.__forceClosePending) {
                setTimeout(checkClosed, 350);
                return;
            }
            // Todo __forceClose: unblock any pending `upgradeneeded` or `deleteDatabase` calls
            const evt = createEvent('close');
            setTimeout(() => {
                delete me.__forcedMessage;
                delete me.__forced;
                me.dispatchEvent(evt);
            });
        }
    }
    if (!me.__closed) { // Avoid recursing
        me.__closed = true;
        const nodewebsqlDb = me.__db._db;
        if (!nodewebsqlDb || // In a browser where we can't listen for close errors
            !nodewebsqlDb._db // User is using some custom node-websql implementation where we don't know how to listen for close errors
        ) {
            me.__forceClosePending = false;
        } else {
            // `__db` is node-websql's `WebSQLDatabase` instance; the first `_db` is node-websql's reference to
            //   its `SQLiteDatabase` class, and the second is to the underlying `sqlite3.Database` instance
            nodewebsqlDb._db.close(function (err) { // Access the underlying SQLite3 database instance and close: https://github.com/mapbox/node-sqlite3/wiki/API#databaseclosecallback
                if (err) {
                    erred = true;
                    if (!me.__forced) {
                        console.log('The close attempt erred so treating as a force close.');
                        me.__forceClose(err.message);
                        // We're already inside the close listener so we need to disable
                        //   subsequent (async-triggered) checks by `__forceClose`, permitting it to send out a final close event
                        me.__forceClosePending = false;
                    } else {
                        console.log('The forced close request itself erred. No further action being taken though AbortError and close events will continue if not yet complete.');
                    }
                } else {
                    me.__forceClosePending = false;
                }
            });
        }
    }
    if (me.__forced) {
        me.__transactions.forEach(function (trans) {
            trans.on__abort = function () {
                ct++;
                checkClosed();
            };
            trans.__abortTransaction(createDOMException('AbortError', 'The connection was force-closed: ' + (me.__forcedMessage || '')));
        });
    }
};

/**
 * Starts a new transaction.
 * @param {string|string[]} storeNames
 * @param {string} mode
 * @returns {IDBTransaction}
 */
IDBDatabase.prototype.transaction = function (storeNames /* , mode */) {
    let mode = arguments[1];
    storeNames = typeof storeNames === 'string'
        ? [storeNames]
        : (util.isIterable(storeNames)
            ? [ // Creating new array also ensures sequence is passed by value: https://heycam.github.io/webidl/#idl-sequence
                ...new Set( // to be unique
                    util.convertToSequenceDOMString(storeNames) // iterables have `ToString` applied (and we convert to array for convenience)
                )
            ].sort() // must be sorted
            : (function () {
                throw new TypeError('You must supply a valid `storeNames` to `IDBDatabase.transaction`');
            }()));

    // Since SQLite (at least node-websql and definitely WebSQL) requires
    //   locking of the whole database, to allow simultaneous readwrite
    //   operations on transactions without overlapping stores, we'd probably
    //   need to save the stores in separate databases (we could also consider
    //   prioritizing readonly but not starving readwrite).
    // Even for readonly transactions, due to [issue 17](https://github.com/nolanlawson/node-websql/issues/17),
    //   we're not currently actually running the SQL requests in parallel.
    if (typeof mode === 'number') {
        mode = mode === 1 ? 'readwrite' : 'readonly';
        CFG.DEBUG && console.log('Mode should be a string, but was specified as ', mode); // Todo Deprecated: Remove this option as no longer in spec
    } else {
        mode = mode || 'readonly';
    }

    IDBTransaction.__assertNotVersionChange(this.__versionTransaction);
    if (this.__closed) {
        throw createDOMException('InvalidStateError', 'An attempt was made to start a new transaction on a database connection that is not open');
    }

    storeNames.forEach((storeName) => {
        if (!this.objectStoreNames.contains(storeName)) {
            throw createDOMException('NotFoundError', 'The "' + storeName + '" object store does not exist');
        }
    });

    if (storeNames.length === 0) {
        throw createDOMException('InvalidAccessError', 'No valid object store names were specified');
    }

    if (mode !== 'readonly' && mode !== 'readwrite') {
        throw new TypeError('Invalid transaction mode: ' + mode);
    }

    // Do not set __active flag to false yet: https://github.com/w3c/IndexedDB/issues/87
    const trans = IDBTransaction.__createInstance(this, storeNames, mode);
    this.__transactions.push(trans);
    return trans;
};

// Todo __forceClose: Add tests for `__forceClose`
IDBDatabase.prototype.__forceClose = function (msg) {
    const me = this;
    me.__forced = true;
    me.__forcedMessage = msg;
    me.__forceClosePending = true;
    me.close();
};

listeners.forEach((listener) => {
    Object.defineProperty(IDBDatabase.prototype, listener, {
        enumerable: true,
        configurable: true,
        get: function () {
            throw new TypeError('Illegal invocation');
        },
        set: function (val) {
            throw new TypeError('Illegal invocation');
        }
    });
});

readonlyProperties.forEach((prop) => {
    Object.defineProperty(IDBDatabase.prototype, prop, {
        enumerable: true,
        configurable: true,
        get: function () {
            throw new TypeError('Illegal invocation');
        }
    });
});

Object.defineProperty(IDBDatabase.prototype, 'constructor', {
    enumerable: false,
    writable: true,
    configurable: true,
    value: IDBDatabase
});

Object.defineProperty(IDBDatabase, 'prototype', {
    writable: false
});

export default IDBDatabase;
