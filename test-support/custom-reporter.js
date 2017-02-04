/* globals shimNS, add_completion_callback */
// Now set-up our mechanism to report results back
(function () {
    // Although we needed a few of these in environment.js, we cannot set there as some are only exposed after including the test framework
    /*
    ShimEvent, ShimCustomEvent, ShimEventTarget, ShimDOMException,
    Event, CustomEvent, EventTarget, DOMException,
    XMLHttpRequest, URL, URLSearchParams, postMessage, Worker, ServiceWorker, SharedWorker,
    _core,_globalProxy,__timers,_top,_parent,_frameElement,_document,_sessionHistory,_currentSessionHistoryEntryIndex,_length,_virtualConsole,
    length,window,frameElement,frames,self,parent,top,document,location,history,navigator,addEventListener,removeEventListener,dispatchEvent,setTimeout,setInterval,clearInterval,clearTimeout,
    __stopAllTimers,
    atob,btoa,FileReader,ArrayBuffer,Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,stop,close,getComputedStyle,console,name,innerWidth,innerHeight,outerWidth,outerHeight,pageXOffset,pageYOffset,screenX,screenY,screenLeft,screenTop,scrollX,scrollY,
    scrollTop,scrollLeft,
    screen,alert,blur,confirm,
    createPopup,
    focus,moveBy,moveTo,open,print,prompt,resizeBy,resizeTo,scroll,scrollBy,scrollTo,toString,
    log,
    Object, Function
    */
    const nonEnumerables = ['Blob', 'File']; // These are needed by IndexedDB tests
    nonEnumerables.concat(Object.keys(shimNS.window)).forEach(function (prop) {
        if (prop[0] === '_' || // One type added by jsdom
            [
                // Already added
                'clearTimeout', 'setTimeout',
                'addEventListener', 'document',
                // Let's allow us to override the jsdom console with that in the main script
                'console',
                // Not in Chrome (and at least log should not become a global as used in test scripts)
                'scrollTop', 'scrollLeft', 'createPopup', 'log'
            ].includes(prop)) {
            return;
        }
        this[prop] = shimNS.window[prop];
    }, this);
    // shimIndexedDB.__debug(true);
    window = this; // This gets negated by the above setting of `this` despite that we earlier set `window` as an alias of `this`

    const colors = shimNS.colors;
    const theme = {
        pass: 'green',
        fail: 'red',
        timeout: 'red',
        notrun: 'red'
    };
    colors.setTheme(theme);

    /*
    function unescapeHTML (s) {
        return s
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&amp;/g, '&');
    }
    */
    function write (statusText, status) {
        const color = colors[Object.keys(theme)[status]];
        let msg = color(statusText);
        shimNS.statuses[statusText] += 1;
        msg += shimNS.statuses[statusText];
        shimNS.write(msg);
    }

    const fileName = shimNS.fileName;
    function reportResults (tests, harnessStatus) {
        // Todo: Look instead on `id=log` and possibly `id=summary` or
        //      `id=metadata_cache` if we add one (and `id=metadata_cache`?)
        // Insert our own reporting to be ready once tests evaluate
        const trs = [...document.querySelectorAll('table#results > tbody > tr')];
        const jsonOutput = {
            test: '/indexeddb/' + fileName.replace(/\.js$/, '.htm'),
            subtests: [],
            status: 'OK', // When does the status at this level change?
            message: null // When does the message at this level change?
        };
        trs.forEach((tr, i) => {
            const test = tests[i];
            const tds = [...tr.querySelectorAll('td')].map((td) => td.textContent);
            const [statusText] = tds; // 2nd is testName
            let [,, assertions, messageWithAnyStack] = tds;
            if (messageWithAnyStack === undefined) {
                messageWithAnyStack = assertions;
                assertions = undefined;
            }
            write(statusText, test.status);
            if (!shimNS.files[statusText].includes(fileName)) shimNS.files[statusText].push(fileName);
            if (shimNS.fileMap) {
                if (!shimNS.fileMap.has(fileName)) shimNS.fileMap.set(fileName, [0, 0]);
                const [pass, total] = shimNS.fileMap.get(fileName);
                shimNS.fileMap.set(fileName, [pass + (test.status === 0), total + 1]);
            }
            if (shimNS.jsonOutput) {
                jsonOutput.subtests.push({
                    name: test.name,
                    status: statusText.toUpperCase(),
                    message: test.message || null
                });
            }
            shimNS.writeln(' (' + fileName + '): ' + test.name);
            if (assertions) shimNS.writeln(assertions);
            if (test.message && test.stack) shimNS.writeln((test.message || ' ') + test.stack);
        });
        if (shimNS.jsonOutput) shimNS.jsonOutput.results.push(jsonOutput);
        shimNS.finished();
    }
    add_completion_callback((...args) => {
        try {
            reportResults(...args);
        } catch (err) {
            shimNS.writeln('err' + err);
        }
    });
}());
