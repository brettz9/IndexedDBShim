/* eslint-env mocha */
/* globals expect, util */
/* eslint-disable no-var */
describe('IDBObjectStore.put (only)', function () {
    'use strict';

    function makeCodeUnits (start, end, converter) {
        return function (done) {
            util.createDatabase('inline', function (err, db) {
                if (err) {
                    expect(function () { throw err; }).to.not.throw(Error);
                    done();
                    return;
                }
                const tx = db.transaction('inline', 'readwrite');
                tx.onerror = done;

                const store = tx.objectStore('inline');

                const expected = [];
                for (let i = start; i <= end; i++) {
                    expected.push({id: i, str: converter(i)});
                    store.put({id: i, str: converter(i)});
                }

                let allValues;
                util.getAll(store, function (err, data) {
                    if (err) {
                        expect(function () { throw err; }).to.not.throw(Error);
                        done();
                        return;
                    }
                    allValues = data.map((d) => d.value);
                });

                tx.oncomplete = function () {
                    expect(allValues).to.have.lengthOf(end - start + 1);
                    console.log('allValues', allValues);
                    console.log('expected', expected);
                    expect(allValues).to.deep.equal(expected);

                    db.close();
                    done();
                };
            });
        };
    }

    function makeTestGroup (max, string, converter) {
        const inc = 1000;
        for (let i = 0; i < max; i += inc) {
            let end = i + inc - 1;
            if (end > max) {
                end = max;
            }
            it(`should be able to store and retrieve all individual ${string} ${i}-${i + inc - 1} inclusive`, makeCodeUnits(i, end, converter));
        }
    }
    // npm run --test=IDBObjectStore/put-spec-chars.js mocha
    makeTestGroup(0xFFFF, 'Unicode UTF-16 code units (including surrogates)', String.fromCharCode);
    makeTestGroup(0x10FFFF, 'Unicode code points', String.fromCodePoint);
});
