let nextId;

const JSOG = {};

nextId = 0;

const isArray = Array.isArray || function (obj) {
    return Object.prototype.toString.call(obj) === '[object Array]';
};

function hasCustomJsonificaiton (obj) {
    return obj.toJSON != null;
}

const JSOGObjectID = '__jsogObjectId';

JSOG.encode = function (original, idProperty, refProperty) {
    if (idProperty == null) {
        idProperty = '@id';
    }
    if (refProperty == null) {
        refProperty = '@ref';
    }
    const sofar = {};
    const objectsWithJSOGObjectID = [];

    const idOf = function (obj) {
        if (!obj[JSOGObjectID]) {
            obj[JSOGObjectID] = '' + (nextId++);
            objectsWithJSOGObjectID.push(obj);
        }
        return obj[JSOGObjectID];
    };
    const doEncode = function (original) {
        const encodeObject = function (original) {
            let key, obj1, obj2, value;
            const id = idOf(original);
            if (sofar[id]) {
                return ( // eslint-disable-line no-return-assign
                    obj1 = {},
                    obj1['' + refProperty] = id,
                    obj1
                );
            }
            const result = sofar[id] = (
                obj2 = {},
                obj2['' + idProperty] = id,
                obj2
            );
            for (key in original) {
                value = original[key];
                if (key !== JSOGObjectID) {
                    result[key] = doEncode(value);
                }
            }
            return result;
        };
        const encodeArray = function (original) {
            let val;
            return (function () {
                let i, len;
                const results = [];
                for (i = 0, len = original.length; i < len; i++) {
                    val = original[i];
                    results.push(doEncode(val));
                }
                return results;
            })();
        };
        if (original == null) {
            return original;
        } else if (hasCustomJsonificaiton(original)) {
            return original;
        } else if (isArray(original)) {
            return encodeArray(original);
        } else if (typeof original === 'object') {
            return encodeObject(original);
        } else {
            return original;
        }
    };

    const result = doEncode(original);
    for (let i = 0; i < objectsWithJSOGObjectID.length; i++) {
        delete objectsWithJSOGObjectID[i][JSOGObjectID];
    }

    return result;
};

JSOG.decode = function (encoded, idProperty, refProperty) {
    if (idProperty == null) {
        idProperty = '@id';
    }
    if (refProperty == null) {
        refProperty = '@ref';
    }
    const found = {};
    const doDecode = function (encoded) {
        const decodeObject = function (encoded) {
            let id, key, ref, value;
            ref = encoded[refProperty];
            if (ref != null) {
                ref = ref.toString();
            }
            if (ref != null) {
                return found[ref];
            }
            const result = {};
            id = encoded[idProperty];
            if (id != null) {
                id = id.toString();
            }
            if (id) {
                found[id] = result;
            }
            for (key in encoded) {
                value = encoded[key];
                if (key !== idProperty) {
                    result[key] = doDecode(value);
                }
            }
            return result;
        };
        const decodeArray = function (encoded) {
            let value;
            return (function () {
                let i, len;
                const results = [];
                for (i = 0, len = encoded.length; i < len; i++) {
                    value = encoded[i];
                    results.push(doDecode(value));
                }
                return results;
            })();
        };
        if (encoded == null) {
            return encoded;
        } else if (isArray(encoded)) {
            return decodeArray(encoded);
        } else if (typeof encoded === 'object') {
            return decodeObject(encoded);
        } else {
            return encoded;
        }
    };
    return doDecode(encoded);
};

JSOG.stringify = function (obj) {
    return JSON.stringify(JSOG.encode(obj));
};

JSOG.parse = function (str) {
    return JSOG.decode(JSON.parse(str));
};

module.exports = JSOG;
