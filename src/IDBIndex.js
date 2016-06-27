import {createDOMException} from './DOMException.js';
import {IDBCursor, IDBCursorWithValue} from './IDBCursor.js';
import * as util from './util.js';
import Key from './Key.js';
import IDBKeyRange from './IDBKeyRange.js';
import Sca from './Sca.js';
import CFG from './cfg.js';

/**
 * IDB Index
 * http://www.w3.org/TR/IndexedDB/#idl-def-IDBIndex
 * @param {IDBObjectStore} store
 * @param {IDBIndexProperties} indexProperties
 * @constructor
 */
function IDBIndex (store, indexProperties) {
    this.objectStore = store;
    this.name = indexProperties.columnName;
    this.keyPath = indexProperties.keyPath;
    this.multiEntry = indexProperties.optionalParams && indexProperties.optionalParams.multiEntry;
    this.unique = indexProperties.optionalParams && indexProperties.optionalParams.unique;
    this.__deleted = !!indexProperties.__deleted;
}

/**
 * Clones an IDBIndex instance for a different IDBObjectStore instance.
 * @param {IDBIndex} index
 * @param {IDBObjectStore} store
 * @protected
 */
IDBIndex.__clone = function (index, store) {
    return new IDBIndex(store, {
        columnName: index.name,
        keyPath: index.keyPath,
        optionalParams: {
            multiEntry: index.multiEntry,
            unique: index.unique
        }
    });
};

/**
 * Creates a new index on an object store.
 * @param {IDBObjectStore} store
 * @param {IDBIndex} index
 * @returns {IDBIndex}
 * @protected
 */
IDBIndex.__createIndex = function (store, index) {
    const columnExists = !!store.__indexes[index.name] && store.__indexes[index.name].__deleted;

    // Add the index to the IDBObjectStore
    store.__indexes[index.name] = index;
    store.indexNames.push(index.name);

    // Create the index in WebSQL
    const transaction = store.transaction;
    transaction.__addToTransactionQueue(function createIndex (tx, args, success, failure) {
        function error (tx, err) {
            failure(createDOMException(0, 'Could not create index "' + index.name + '"', err));
        }

        function applyIndex (tx) {
            // Update the object store's index list
            IDBIndex.__updateIndexList(store, tx, function () {
                // Add index entries for all existing records
                tx.executeSql('SELECT * FROM ' + util.quote('s_' + store.name), [], function (tx, data) {
                    CFG.DEBUG && console.log('Adding existing ' + store.name + ' records to the ' + index.name + ' index');
                    addIndexEntry(0);

                    function addIndexEntry (i) {
                        if (i < data.rows.length) {
                            try {
                                const value = Sca.decode(data.rows.item(i).value);
                                let indexKey = Key.evaluateKeyPathOnValue(value, index.keyPath);
                                indexKey = Key.encode(indexKey, index.multiEntry);

                                tx.executeSql('UPDATE ' + util.quote('s_' + store.name) + ' SET ' + util.quote('_' + index.name) + ' = ? WHERE key = ?', [indexKey, data.rows.item(i).key], function (tx, data) {
                                    addIndexEntry(i + 1);
                                }, error);
                            } catch (e) {
                                // Not a valid value to insert into index, so just continue
                                addIndexEntry(i + 1);
                            }
                        } else {
                            success(store);
                        }
                    }
                }, error);
            }, error);
        }

        if (columnExists) {
            // For a previously existing index, just update the index entries in the existing column
            applyIndex(tx);
        } else {
            // For a new index, add a new column to the object store, then apply the index
            const sql = ['ALTER TABLE', util.quote('s_' + store.name), 'ADD', util.quote('_' + index.name), 'BLOB'].join(' ');
            CFG.DEBUG && console.log(sql);
            tx.executeSql(sql, [], applyIndex, error);
        }
    });
};

/**
 * Deletes an index from an object store.
 * @param {IDBObjectStore} store
 * @param {IDBIndex} index
 * @protected
 */
IDBIndex.__deleteIndex = function (store, index) {
    // Remove the index from the IDBObjectStore
    store.__indexes[index.name].__deleted = true;
    store.indexNames.splice(store.indexNames.indexOf(index.name), 1);

    // Remove the index in WebSQL
    const transaction = store.transaction;
    transaction.__addToTransactionQueue(function deleteIndex (tx, args, success, failure) {
        function error (tx, err) {
            failure(createDOMException(0, 'Could not delete index "' + index.name + '"', err));
        }

        // Update the object store's index list
        IDBIndex.__updateIndexList(store, tx, success, error);
    });
};

/**
 * Updates index list for the given object store.
 * @param {IDBObjectStore} store
 * @param {object} tx
 * @param {function} success
 * @param {function} failure
 */
IDBIndex.__updateIndexList = function (store, tx, success, failure) {
    const indexList = {};
    for (let i = 0; i < store.indexNames.length; i++) {
        const idx = store.__indexes[store.indexNames[i]];
        /** @type {IDBIndexProperties} **/
        indexList[idx.name] = {
            columnName: idx.name,
            keyPath: idx.keyPath,
            optionalParams: {
                unique: idx.unique,
                multiEntry: idx.multiEntry
            },
            deleted: !!idx.deleted
        };
    }

    CFG.DEBUG && console.log('Updating the index list for ' + store.name, indexList);
    tx.executeSql('UPDATE __sys__ SET indexList = ? WHERE name = ?', [JSON.stringify(indexList), store.name], function () {
        success(store);
    }, failure);
};

/**
 * Retrieves index data for the given key
 * @param {*|IDBKeyRange} key
 * @param {string} opType
 * @returns {IDBRequest}
 * @private
 */
IDBIndex.prototype.__fetchIndexData = function (key, opType) {
    const me = this;
    let hasKey, encodedKey;

    // key is optional
    if (arguments.length === 1) {
        opType = key;
        hasKey = false;
    } else {
        Key.validate(key);
        encodedKey = Key.encode(key, me.multiEntry);
        hasKey = true;
    }

    return me.objectStore.transaction.__addToTransactionQueue(function (...args) {
        fetchIndexData(me, hasKey, encodedKey, opType, ...args);
    });
};

/**
 * Opens a cursor over the given key range.
 * @param {IDBKeyRange} range
 * @param {string} direction
 * @returns {IDBRequest}
 */
IDBIndex.prototype.openCursor = function (range, direction) {
    return new IDBCursorWithValue(range, direction, this.objectStore, this, '_' + this.name, 'value').__req;
};

/**
 * Opens a cursor over the given key range.  The cursor only includes key values, not data.
 * @param {IDBKeyRange} range
 * @param {string} direction
 * @returns {IDBRequest}
 */
IDBIndex.prototype.openKeyCursor = function (range, direction) {
    return new IDBCursor(range, direction, this.objectStore, this, '_' + this.name, 'key').__req;
};

IDBIndex.prototype.get = function (key) {
    if (key == null) {
        throw createDOMException('DataError', 'No key was specified');
    }

    return this.__fetchIndexData(key, 'value');
};

IDBIndex.prototype.getKey = function (key) {
    if (key == null) {
        throw createDOMException('DataError', 'No key was specified');
    }

    return this.__fetchIndexData(key, 'key');
};

IDBIndex.prototype.count = function (key) {
    // key is optional
    if (key === undefined) {
        return this.__fetchIndexData('count');
    }
    if (util.instanceOf(key, IDBKeyRange)) {
        return new IDBCursorWithValue(key, 'next', this.objectStore, this, '_' + this.name, 'value', true).__req;
    }
    return this.__fetchIndexData(key, 'count');
};

IDBIndex.prototype.toString = function () {
    return '[object IDBIndex]';
};

Object.defineProperty(IDBIndex, Symbol.hasInstance, {
    value: obj => util.isObj(obj) && typeof obj.openCursor === 'function' && typeof obj.multiEntry === 'boolean'
});

function fetchIndexData (index, hasKey, encodedKey, opType, tx, args, success, error, multiChecks) {
    const sql = ['SELECT * FROM', util.quote('s_' + index.objectStore.name), 'WHERE', util.quote('_' + index.name), 'NOT NULL'];
    const sqlValues = [];
    if (hasKey) {
        if (multiChecks) {
            sql.push('AND (');
            multiChecks.forEach((innerKey, i) => {
                if (i > 0) sql.push('OR');
                sql.push(util.quote('_' + index.name), 'LIKE ?');
                sqlValues.push('%' + Key.encode(innerKey, index.multiEntry) + '%');
            });
            sql.push(')');
        } else if (index.multiEntry) {
            sql.push('AND', util.quote('_' + index.name), 'LIKE ?');
            sqlValues.push('%' + encodedKey + '%');
        } else {
            sql.push('AND', util.quote('_' + index.name), '= ?');
            sqlValues.push(encodedKey);
        }
    }
    CFG.DEBUG && console.log('Trying to fetch data for Index', sql.join(' '), sqlValues);
    tx.executeSql(sql.join(' '), sqlValues, function (tx, data) {
        let recordCount = 0, record = null;
        if (index.multiEntry) {
            for (let i = 0; i < data.rows.length; i++) {
                const row = data.rows.item(i);
                const rowKey = Key.decode(row['_' + index.name]);
                if (hasKey && (
                    (multiChecks && multiChecks.some((check) => rowKey.includes(check))) || // More precise than our SQL
                    Key.isMultiEntryMatch(encodedKey, row['_' + index.name]))) {
                    recordCount++;
                    record = record || row;
                } else if (!hasKey && !multiChecks) {
                    if (rowKey !== undefined) {
                        recordCount = recordCount + (Array.isArray(rowKey) ? rowKey.length : 1);
                        record = record || row;
                    }
                }
            }
        } else {
            recordCount = data.rows.length;
            record = recordCount && data.rows.item(0);
        }
        if (opType === 'count') {
            success(recordCount);
        } else if (recordCount === 0) {
            success(undefined);
        } else if (opType === 'key') {
            success(Key.decode(record.key));
        } else { // when opType is value
            success(Sca.decode(record.value));
        }
    }, error);
}

export {fetchIndexData, IDBIndex, IDBIndex as default};
