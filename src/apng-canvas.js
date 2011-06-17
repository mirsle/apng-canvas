/**
 * Copyright (c) 2011 David Mzareulyan
 *
 * apng-canvas
 *
 * Project page: https://github.com/davidmz/apng-canvas
 *
 */
(function() {
    /************************* PUBLIC ***************************/

    var global = (function(){ return this; })();

    var APNG = global.APNG = {};

    var featuresD = null;
    APNG.checkNativeFeatures = function(callback) {
        var firstCall = !featuresD;
        var d = firstCall ? (featuresD = new Deferred()) : featuresD;
        if (callback) d.promise().done(callback);
        if (!firstCall) return d.promise();

        var res = { canvas: false, apng: false };
        var canvas = document.createElement("canvas");
        if (typeof canvas.getContext == "undefined") {
            // canvas is not supported
            d.resolve(res);
        } else {
            // canvas is supported
            res.canvas = true;
            // see http://eligrey.com/blog/post/apng-feature-detection
            var img = new Image();
            img.onload = function() {
                var ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                if (ctx.getImageData(0, 0, 1, 1).data[3] === 0 ) {
                    res.apng = true;
                    d.resolve(res);
                } else {
                    d.resolve(res);
                }
            };
            // frame 1 (skipped on apng-supporting browsers): [0, 0, 0, 255]
            // frame 2: [0, 0, 0, 0]
            img.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACGFjVEwAAAABAAAAAcMq2TYAAAANSURBVAiZY2BgYPgPAAEEAQB9ssjfAAAAGmZjVEwAAAAAAAAAAQAAAAEAAAAAAAAAAAD6A+gBAbNU+2sAAAARZmRBVAAAAAEImWNgYGBgAAAABQAB6MzFdgAAAABJRU5ErkJggg==";
        }
        return d.promise();
    };

    var neededD = null;
    APNG.ifNeeded = function(callback) {
        var firstCall = !neededD;
        var d = firstCall ? (neededD = new Deferred()) : neededD;
        if (callback) d.promise().done(callback);
        if (!firstCall) return d.promise();

        if (location.protocol != "http:" && location.protocol != "https:") {
            d.reject("apng-canvas doesn't work on pages loaded by '" + location.protocol + "' protocol");
            return d.promise();
        }

        this.checkNativeFeatures().done(function(f) {
            if (f.canvas && !f.apng) {
                d.resolve();
            } else {
                if (!f.canvas) d.reject("Browser doesn't support canvas");
                if (f.apng) d.reject("Browser has native APNG support");
            }
        }).done(function() { d.reject(); });
        return d.promise();
    };

    APNG.createAPNGCanvas = function(url, callback) {
        var d = new Deferred();
        if (callback) d.promise().done(callback);
        loadBinary(url)
                .done(function(imageData) {
                    parsePNGData(imageData)
                            .done(function(aPng) {
                                var canvas = document.createElement("canvas");
                                canvas.width = aPng.width;
                                canvas.height = aPng.height;
                                if (aPng.isAnimated) {
                                    animate(aPng, canvas);
                                } else {
                                    var img = new Image();
                                    img.onload = function() { canvas.getContext('2d').drawImage(img, 0, 0); };
                                    var db = new DataBuilder();
                                    db.append(imageData);
                                    img.src = db.getUrl("image/png");
                                }
                                d.resolve(canvas);
                            })
                            .fail(function(reason) {
                                d.reject(reason);
                            });
                })
                .fail(function(reason) {
                    d.reject(reason);
                });

        return d.promise();
    };

    APNG.replaceImage = function(img) {
        return APNG.createAPNGCanvas(img.src).done(function(canvas) {
            img.parentNode.insertBefore(canvas, img);
            img.parentNode.removeChild(img);
        });
    };

    /************************* HELPERS ***************************/

    // "\x89PNG\x0d\x0a\x1a\x0a"
    var PNG_SIGNATURE = String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

    var readDWord = function(data) {
        var x = 0;
        for (var i = 0; i < 4; i++) x += (data.charCodeAt(i) << ((3 - i) * 8));
        return x;
    };

    var readWord = function(data) {
        var x = 0;
        for (var i = 0; i < 2; i++) x += (data.charCodeAt(i) << ((1 - i) * 8));
        return x;
    };

    var writeChunk = function(type, data) {
        var res = "";
        res += writeDWord(data.length);
        res += type;
        res += data;
        res += writeDWord(crc32(type + data));
        return res;
    };

    var writeDWord = function(num) {
        return String.fromCharCode(
                ((num >> 24) & 0xff),
                ((num >> 16) & 0xff),
                ((num >> 8) & 0xff),
                (num & 0xff)
        );
    };

    var DataBuilder = function() {
        this.parts = [];
    };
    DataBuilder.prototype.append = function(data) {
        this.parts.push(data);
    };
    DataBuilder.prototype.getUrl = function(contentType) {
        return "data:" + contentType + "," + escape(this.parts.join(""));
    };

    /************************* INTERNALS ***************************/

    if (
            typeof XMLHttpRequest.prototype.responseBody != 'undefined'
            && typeof document.addEventListener != 'undefined'
    ) {
        // создаём VBScript-функцию для IE9
        // see http://miskun.com/javascript/internet-explorer-and-binary-files-data-access/
        document.addEventListener("DOMContentLoaded", function() {
            var script = document.createElement("script");
            script.setAttribute('type','text/vbscript');
            script.text =   "Function APNGIEBinaryToBinStr(Binary)\r\n" +
                            "   APNGIEBinaryToBinStr = CStr(Binary)\r\n" +
                            "End Function\r\n";
            document.body.appendChild(script);
        });
    }

    /**
     * Загрузка двоичных данных как строки с символами \x00 - \xff
     * @param url
     */
    var loadBinary = function(url) {
        var d = new Deferred();

        var xhr = new XMLHttpRequest();

        var BlobBuilder = (global.BlobBuilder || global.WebKitBlobBuilder);
        // IE9
        var useResponseBody = (typeof this.responseBody != "undefined");
        // Chrome
        var useResponseType = (typeof this.responseType != "undefined" && typeof BlobBuilder != "undefined");
        // Safari
        var useXUserDefined = (typeof xhr.overrideMimeType != "undefined" && !useResponseType);

        xhr.open('GET', url, true);
        if (useResponseType) { // chrome
            xhr.responseType = "arraybuffer";
        } else if (useXUserDefined) { // FF & old Safari
            xhr.overrideMimeType('text/plain; charset=x-user-defined');
        }
        xhr.onreadystatechange = function(e) {
            if (this.readyState == 4 && this.status == 200) {
                if (useResponseType) { // XHR 2
                    var bb = new BlobBuilder();
                    bb.append(this.response);
                    var reader = new FileReader();
                    reader.onload = function() { d.resolve(this.result); };
                    reader.readAsBinaryString(bb.getBlob());
                } else {
                    var res = "";
                    if (useResponseBody) { // IE
                        // see http://miskun.com/javascript/internet-explorer-and-binary-files-data-access/
                        var raw = APNGIEBinaryToBinStr(this.responseBody);
                        for (var j = 0, l = raw.length; j < l; j++) {
                            var c = raw.charCodeAt(j);
                            res += String.fromCharCode(c & 0xFF, (c >> 8) & 0xFF);
                        }
                    } else { // FF?
                        var binStr = this.responseText;
                        for (var i = 0, len = binStr.length; i < len; ++i)
                            res += String.fromCharCode(binStr.charCodeAt(i) & 0xff);
                    }
                    d.resolve(res);
                }
            } else if (this.readyState == 4) {
                d.reject(xhr);
            }
        };
        xhr.send();

        return d.promise();
    };

    var parsePNGData = function(imageData) {
        var d = new Deferred();

        if (imageData.substr(0, 8) != PNG_SIGNATURE) {
            d.reject("Invalid PNG file signature");
            return d.promise();
        }

        var aPng = {
            width:  0,
            height: 0,
            isAnimated: false,
            numPlays:   0,
            frames: []
        };

        var headerData, preData = "", postData = "";

        var off = 8, frame = null;
        do {
            var length = readDWord(imageData.substr(off, 4));
            var type = imageData.substr(off + 4, 4);
            var data;

            switch (type) {
                case "IHDR":
                    data = imageData.substr(off + 8, length);
                    headerData = data;
                    aPng.width = readDWord(data.substr(0, 4));
                    aPng.height = readDWord(data.substr(4, 4));
                    break;
                case "acTL":
                    aPng.isAnimated = true;
                    aPng.numPlays = readDWord(imageData.substr(off + 8 + 4, 4));
                    break;
                case "fcTL":
                    if (frame) aPng.frames.push(frame);
                    data = imageData.substr(off + 8, length);
                    frame = {};
                    frame.width     = readDWord(data.substr(4, 4));
                    frame.height    = readDWord(data.substr(8, 4));
                    frame.left      = readDWord(data.substr(12, 4));
                    frame.top       = readDWord(data.substr(16, 4));
                    var delayN      = readWord(data.substr(20, 2));
                    var delayD      = readWord(data.substr(22, 2));
                    if (delayD == 0) delayD = 100;
                    frame.delay = 1000 * delayN / delayD;
                    frame.disposeOp = data.charCodeAt(24);
                    frame.blendOp   = data.charCodeAt(25);
                    frame.dataParts = [];
                    break;
                case "fdAT":
                    if (frame) frame.dataParts.push(imageData.substr(off + 8 + 4, length - 4));
                    break;
                case "IDAT":
                    if (frame) frame.dataParts.push(imageData.substr(off + 8, length));
                    break;
                case "IEND":
                    postData = imageData.substr(off, length + 12);
                    break;
                default:
                    preData += imageData.substr(off, length + 12);
            }
            off += 12 + length;
        } while(type != "IEND" && off < imageData.length);
        if (frame) aPng.frames.push(frame);

        // Вариант неанимированного PNG
        if (!aPng.isAnimated) d.resolve(aPng);

        // Собираем кадры
        var loadedImages = 0;
        for (var i = 0; i < aPng.frames.length; i++) {
            var img = new Image();
            frame = aPng.frames[i];
            frame.img = img;
            img.onload = function() {
                loadedImages++;
                if (loadedImages == aPng.frames.length) d.resolve(aPng);
            };
            img.onerror = function() { d.reject("Image creation error"); };

            var db = new DataBuilder();
            db.append(PNG_SIGNATURE);
            headerData = writeDWord(frame.width) + writeDWord(frame.height) + headerData.substr(8);
            db.append(writeChunk("IHDR", headerData));
            db.append(preData);
            for (var j = 0; j < frame.dataParts.length; j++) {
                db.append(writeChunk("IDAT", frame.dataParts[j]));
            }
            db.append(postData);
            img.src = db.getUrl("image/png");
            delete frame.dataParts;
        }
        return d.promise();
    };

    var animate = function(aPng, canvas) {
        var ctx = canvas.getContext('2d');
        var fNum = 0;
        var prevF = null;
        var tick = function() {
            var f = fNum++ % aPng.frames.length;
            var frame = aPng.frames[f];

            if (f == 0) {
                ctx.clearRect(0, 0, aPng.width, aPng.height);
                prevF = null;
                if (frame.disposeOp == 2) frame.disposeOp = 1;
            }

            if (prevF && prevF.disposeOp == 1) {
                ctx.clearRect(prevF.left, prevF.top, prevF.width, prevF.height);
            } else if (prevF && prevF.disposeOp == 2) {
                ctx.putImageData(prevF.iData, prevF.left, prevF.top);
            }
            prevF = frame;
            prevF.iData = null;
            if (prevF.disposeOp == 2) prevF.iData = ctx.getImageData(frame.left, frame.top, frame.width, frame.height);
            if (frame.blendOp == 0) ctx.clearRect(frame.left, frame.top, frame.width, frame.height);
            ctx.drawImage(frame.img, frame.left, frame.top);

            if (aPng.numPlays == 0 || fNum / aPng.frames.length < aPng.numPlays) {
                setTimeout(tick, frame.delay);
            }
        };
        tick();
    };

})();