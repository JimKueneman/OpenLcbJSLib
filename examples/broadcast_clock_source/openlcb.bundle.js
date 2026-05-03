/* OpenLcbJSLib v0.1.0 — https://github.com/... — generated bundle, do not edit by hand */
var OpenLCB = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    AddressSpace: () => AddressSpace,
    BroadcastTimeClock: () => BroadcastTimeClock,
    BroadcastTimeCommand: () => BroadcastTimeCommand,
    BroadcastTimeEventType: () => BroadcastTimeEventType,
    ConfigMemStreamPhase: () => ConfigMemStreamPhase,
    DccDetectorAddressType: () => DccDetectorAddressType,
    DccDetectorDirection: () => DccDetectorDirection,
    Event: () => Event,
    EventRangeCount: () => EventRangeCount,
    EventStatus: () => EventStatus,
    InvalidArgumentError: () => InvalidArgumentError,
    LocalStorageConfigMemory: () => LocalStorageConfigMemory,
    MTI: () => MTI,
    NotInitializedError: () => NotInitializedError,
    OpenLcb: () => OpenLcb,
    OpenLcbError: () => OpenLcbError,
    OpenLcbNode: () => OpenLcbNode,
    PSI: () => PSI,
    PayloadType: () => PayloadType,
    PoolFullError: () => PoolFullError,
    ProtocolNotSupportedError: () => ProtocolNotSupportedError,
    SpaceEncoding: () => SpaceEncoding,
    StreamState: () => StreamState,
    TrainEmergencyType: () => TrainEmergencyType,
    TrainSearchFlag: () => TrainSearchFlag,
    TrainSearchProtocol: () => TrainSearchProtocol,
    TrainSearchSpeedSteps: () => TrainSearchSpeedSteps,
    TransportBusyError: () => TransportBusyError,
    TransportConnectError: () => TransportConnectError,
    UnknownNodeError: () => UnknownNodeError,
    Version: () => Version,
    WS_STATE: () => WS_STATE,
    WasmLoadError: () => WasmLoadError,
    WebSocketTransport: () => WebSocketTransport
  });

  // wasm/openlcb-core.mjs
  var import_meta = {};
  async function OpenLcbCoreFactory(moduleArg = {}) {
    var moduleRtn;
    var Module = moduleArg;
    var ENVIRONMENT_IS_WEB = !!globalThis.window;
    var ENVIRONMENT_IS_WORKER = !!globalThis.WorkerGlobalScope;
    var ENVIRONMENT_IS_NODE = globalThis.process?.versions?.node && globalThis.process?.type != "renderer";
    if (ENVIRONMENT_IS_NODE) {
      const { createRequire } = await import("node:module");
      var require2 = createRequire(import_meta.url);
    }
    var arguments_ = [];
    var thisProgram = "./this.program";
    var quit_ = (status, toThrow) => {
      throw toThrow;
    };
    var _scriptName = import_meta.url;
    var scriptDirectory = "";
    function locateFile(path) {
      if (Module["locateFile"]) {
        return Module["locateFile"](path, scriptDirectory);
      }
      return scriptDirectory + path;
    }
    var readAsync, readBinary;
    if (ENVIRONMENT_IS_NODE) {
      var fs = require2("node:fs");
      if (_scriptName.startsWith("file:")) {
        scriptDirectory = require2("node:path").dirname(require2("node:url").fileURLToPath(_scriptName)) + "/";
      }
      readBinary = (filename) => {
        filename = isFileURI(filename) ? new URL(filename) : filename;
        var ret = fs.readFileSync(filename);
        return ret;
      };
      readAsync = async (filename, binary = true) => {
        filename = isFileURI(filename) ? new URL(filename) : filename;
        var ret = fs.readFileSync(filename, binary ? void 0 : "utf8");
        return ret;
      };
      if (process.argv.length > 1) {
        thisProgram = process.argv[1].replace(/\\/g, "/");
      }
      arguments_ = process.argv.slice(2);
      quit_ = (status, toThrow) => {
        process.exitCode = status;
        throw toThrow;
      };
    } else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
      try {
        scriptDirectory = new URL(".", _scriptName).href;
      } catch {
      }
      {
        readAsync = async (url) => {
          var response = await fetch(url, { credentials: "same-origin" });
          if (response.ok) {
            return response.arrayBuffer();
          }
          throw new Error(response.status + " : " + response.url);
        };
      }
    } else {
    }
    var out = console.log.bind(console);
    var err = console.error.bind(console);
    var wasmBinary;
    var ABORT = false;
    var isFileURI = (filename) => filename.startsWith("file://");
    class EmscriptenEH {
    }
    class EmscriptenSjLj extends EmscriptenEH {
    }
    var readyPromiseResolve, readyPromiseReject;
    var runtimeInitialized = false;
    function updateMemoryViews() {
      var b = wasmMemory.buffer;
      HEAP8 = new Int8Array(b);
      HEAP16 = new Int16Array(b);
      Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
      HEAPU16 = new Uint16Array(b);
      HEAP32 = new Int32Array(b);
      HEAPU32 = new Uint32Array(b);
      HEAPF32 = new Float32Array(b);
      HEAPF64 = new Float64Array(b);
      HEAP64 = new BigInt64Array(b);
      HEAPU64 = new BigUint64Array(b);
    }
    function preRun() {
      if (Module["preRun"]) {
        if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
        while (Module["preRun"].length) {
          addOnPreRun(Module["preRun"].shift());
        }
      }
      callRuntimeCallbacks(onPreRuns);
    }
    function initRuntime() {
      runtimeInitialized = true;
      wasmExports["__wasm_call_ctors"]();
    }
    function postRun() {
      if (Module["postRun"]) {
        if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
        while (Module["postRun"].length) {
          addOnPostRun(Module["postRun"].shift());
        }
      }
      callRuntimeCallbacks(onPostRuns);
    }
    function abort(what) {
      Module["onAbort"]?.(what);
      what = `Aborted(${what})`;
      err(what);
      ABORT = true;
      what += ". Build with -sASSERTIONS for more info.";
      var e = new WebAssembly.RuntimeError(what);
      readyPromiseReject?.(e);
      throw e;
    }
    var wasmBinaryFile;
    function findWasmBinary() {
      if (Module["locateFile"]) {
        return locateFile("openlcb-core.wasm");
      }
      return new URL("openlcb-core.wasm", import_meta.url).href;
    }
    function getBinarySync(file) {
      if (file == wasmBinaryFile && wasmBinary) {
        return new Uint8Array(wasmBinary);
      }
      if (readBinary) {
        return readBinary(file);
      }
      throw "both async and sync fetching of the wasm failed";
    }
    async function getWasmBinary(binaryFile) {
      if (!wasmBinary) {
        try {
          var response = await readAsync(binaryFile);
          return new Uint8Array(response);
        } catch {
        }
      }
      return getBinarySync(binaryFile);
    }
    async function instantiateArrayBuffer(binaryFile, imports) {
      try {
        var binary = await getWasmBinary(binaryFile);
        var instance = await WebAssembly.instantiate(binary, imports);
        return instance;
      } catch (reason) {
        err(`failed to asynchronously prepare wasm: ${reason}`);
        abort(reason);
      }
    }
    async function instantiateAsync(binary, binaryFile, imports) {
      if (!binary && !ENVIRONMENT_IS_NODE) {
        try {
          var response = fetch(binaryFile, { credentials: "same-origin" });
          var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
          return instantiationResult;
        } catch (reason) {
          err(`wasm streaming compile failed: ${reason}`);
          err("falling back to ArrayBuffer instantiation");
        }
      }
      return instantiateArrayBuffer(binaryFile, imports);
    }
    function getWasmImports() {
      var imports = { env: wasmImports, wasi_snapshot_preview1: wasmImports };
      return imports;
    }
    async function createWasm() {
      function receiveInstance(instance, module) {
        wasmExports = instance.exports;
        assignWasmExports(wasmExports);
        updateMemoryViews();
        return wasmExports;
      }
      function receiveInstantiationResult(result2) {
        return receiveInstance(result2["instance"]);
      }
      var info = getWasmImports();
      if (Module["instantiateWasm"]) {
        return new Promise((resolve, reject) => {
          Module["instantiateWasm"](info, (inst, mod) => {
            resolve(receiveInstance(inst, mod));
          });
        });
      }
      wasmBinaryFile ?? (wasmBinaryFile = findWasmBinary());
      var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
      var exports = receiveInstantiationResult(result);
      return exports;
    }
    class ExitStatus {
      constructor(status) {
        __publicField(this, "name", "ExitStatus");
        this.message = `Program terminated with exit(${status})`;
        this.status = status;
      }
    }
    var HEAP16;
    var HEAP32;
    var HEAP64;
    var HEAP8;
    var HEAPF32;
    var HEAPF64;
    var HEAPU16;
    var HEAPU32;
    var HEAPU64;
    var HEAPU8;
    var callRuntimeCallbacks = (callbacks) => {
      while (callbacks.length > 0) {
        callbacks.shift()(Module);
      }
    };
    var onPostRuns = [];
    var addOnPostRun = (cb) => onPostRuns.push(cb);
    var onPreRuns = [];
    var addOnPreRun = (cb) => onPreRuns.push(cb);
    var noExitRuntime = true;
    var stackRestore = (val) => __emscripten_stack_restore(val);
    var stackSave = () => _emscripten_stack_get_current();
    var UTF8Decoder = globalThis.TextDecoder && new TextDecoder();
    var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
      var maxIdx = idx + maxBytesToRead;
      if (ignoreNul) return maxIdx;
      while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
      return idx;
    };
    var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
      var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
      if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
        return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
      }
      var str = "";
      while (idx < endPtr) {
        var u0 = heapOrArray[idx++];
        if (!(u0 & 128)) {
          str += String.fromCharCode(u0);
          continue;
        }
        var u1 = heapOrArray[idx++] & 63;
        if ((u0 & 224) == 192) {
          str += String.fromCharCode((u0 & 31) << 6 | u1);
          continue;
        }
        var u2 = heapOrArray[idx++] & 63;
        if ((u0 & 240) == 224) {
          u0 = (u0 & 15) << 12 | u1 << 6 | u2;
        } else {
          u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
        }
        if (u0 < 65536) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 65536;
          str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
        }
      }
      return str;
    };
    var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) => ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : "";
    var ___assert_fail = (condition, filename, line, func) => abort(`Assertion failed: ${UTF8ToString(condition)}, at: ` + [filename ? UTF8ToString(filename) : "unknown filename", line, func ? UTF8ToString(func) : "unknown function"]);
    var readEmAsmArgsArray = [];
    var readEmAsmArgs = (sigPtr, buf) => {
      readEmAsmArgsArray.length = 0;
      var ch;
      while (ch = HEAPU8[sigPtr++]) {
        var wide = ch != 105;
        wide &= ch != 112;
        buf += wide && buf % 8 ? 4 : 0;
        readEmAsmArgsArray.push(ch == 112 ? HEAPU32[buf >> 2] : ch == 106 ? HEAP64[buf >> 3] : ch == 105 ? HEAP32[buf >> 2] : HEAPF64[buf >> 3]);
        buf += wide ? 8 : 4;
      }
      return readEmAsmArgsArray;
    };
    var runEmAsmFunction = (code, sigPtr, argbuf) => {
      var args = readEmAsmArgs(sigPtr, argbuf);
      return ASM_CONSTS[code](...args);
    };
    var _emscripten_asm_const_double = (code, sigPtr, argbuf) => runEmAsmFunction(code, sigPtr, argbuf);
    var _emscripten_asm_const_int = (code, sigPtr, argbuf) => runEmAsmFunction(code, sigPtr, argbuf);
    var getHeapMax = () => 2147483648;
    var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
    var growMemory = (size) => {
      var oldHeapSize = wasmMemory.buffer.byteLength;
      var pages = (size - oldHeapSize + 65535) / 65536 | 0;
      try {
        wasmMemory.grow(pages);
        updateMemoryViews();
        return 1;
      } catch (e) {
      }
    };
    var _emscripten_resize_heap = (requestedSize) => {
      var oldSize = HEAPU8.length;
      requestedSize >>>= 0;
      var maxHeapSize = getHeapMax();
      if (requestedSize > maxHeapSize) {
        return false;
      }
      for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
        var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
        overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
        var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
        var replacement = growMemory(newSize);
        if (replacement) {
          return true;
        }
      }
      return false;
    };
    var getCFunc = (ident) => {
      var func = Module["_" + ident];
      return func;
    };
    var writeArrayToMemory = (array, buffer) => {
      HEAP8.set(array, buffer);
    };
    var lengthBytesUTF8 = (str) => {
      var len = 0;
      for (var i = 0; i < str.length; ++i) {
        var c = str.charCodeAt(i);
        if (c <= 127) {
          len++;
        } else if (c <= 2047) {
          len += 2;
        } else if (c >= 55296 && c <= 57343) {
          len += 4;
          ++i;
        } else {
          len += 3;
        }
      }
      return len;
    };
    var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
      if (!(maxBytesToWrite > 0)) return 0;
      var startIdx = outIdx;
      var endIdx = outIdx + maxBytesToWrite - 1;
      for (var i = 0; i < str.length; ++i) {
        var u = str.codePointAt(i);
        if (u <= 127) {
          if (outIdx >= endIdx) break;
          heap[outIdx++] = u;
        } else if (u <= 2047) {
          if (outIdx + 1 >= endIdx) break;
          heap[outIdx++] = 192 | u >> 6;
          heap[outIdx++] = 128 | u & 63;
        } else if (u <= 65535) {
          if (outIdx + 2 >= endIdx) break;
          heap[outIdx++] = 224 | u >> 12;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
        } else {
          if (outIdx + 3 >= endIdx) break;
          heap[outIdx++] = 240 | u >> 18;
          heap[outIdx++] = 128 | u >> 12 & 63;
          heap[outIdx++] = 128 | u >> 6 & 63;
          heap[outIdx++] = 128 | u & 63;
          i++;
        }
      }
      heap[outIdx] = 0;
      return outIdx - startIdx;
    };
    var stringToUTF8 = (str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
    var stackAlloc = (sz) => __emscripten_stack_alloc(sz);
    var stringToUTF8OnStack = (str) => {
      var size = lengthBytesUTF8(str) + 1;
      var ret = stackAlloc(size);
      stringToUTF8(str, ret, size);
      return ret;
    };
    var ccall = (ident, returnType, argTypes, args, opts) => {
      var toC = { string: (str) => {
        var ret2 = 0;
        if (str !== null && str !== void 0 && str !== 0) {
          ret2 = stringToUTF8OnStack(str);
        }
        return ret2;
      }, array: (arr) => {
        var ret2 = stackAlloc(arr.length);
        writeArrayToMemory(arr, ret2);
        return ret2;
      } };
      function convertReturnValue(ret2) {
        if (returnType === "string") {
          return UTF8ToString(ret2);
        }
        if (returnType === "boolean") return Boolean(ret2);
        return ret2;
      }
      var func = getCFunc(ident);
      var cArgs = [];
      var stack = 0;
      if (args) {
        for (var i = 0; i < args.length; i++) {
          var converter = toC[argTypes[i]];
          if (converter) {
            if (stack === 0) stack = stackSave();
            cArgs[i] = converter(args[i]);
          } else {
            cArgs[i] = args[i];
          }
        }
      }
      var ret = func(...cArgs);
      function onDone(ret2) {
        if (stack !== 0) stackRestore(stack);
        return convertReturnValue(ret2);
      }
      ret = onDone(ret);
      return ret;
    };
    var cwrap = (ident, returnType, argTypes, opts) => {
      var numericArgs = !argTypes || argTypes.every((type) => type === "number" || type === "boolean");
      var numericRet = returnType !== "string";
      if (numericRet && numericArgs && !opts) {
        return getCFunc(ident);
      }
      return (...args) => ccall(ident, returnType, argTypes, args, opts);
    };
    {
      if (Module["noExitRuntime"]) noExitRuntime = Module["noExitRuntime"];
      if (Module["print"]) out = Module["print"];
      if (Module["printErr"]) err = Module["printErr"];
      if (Module["wasmBinary"]) wasmBinary = Module["wasmBinary"];
      if (Module["arguments"]) arguments_ = Module["arguments"];
      if (Module["thisProgram"]) thisProgram = Module["thisProgram"];
      if (Module["preInit"]) {
        if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
        while (Module["preInit"].length > 0) {
          Module["preInit"].shift()();
        }
      }
    }
    Module["ccall"] = ccall;
    Module["cwrap"] = cwrap;
    var ASM_CONSTS = { 2344: ($0) => {
      if (Module.onGridconnectTx) {
        Module.onGridconnectTx(UTF8ToString($0));
      }
    }, 2422: ($0, $1, $2, $3, $4) => {
      if (Module.onConfigMemRead) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        return Module.onConfigMemRead(nid, $2 >>> 0, $3, $4) | 0;
      }
      return 0;
    }, 2570: ($0, $1, $2, $3, $4) => {
      if (Module.onConfigMemWrite) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        return Module.onConfigMemWrite(nid, $2 >>> 0, $3, $4) | 0;
      }
      return 0;
    }, 2720: ($0, $1) => {
      if (Module.onReboot) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onReboot(nid);
      }
    }, 2815: ($0, $1) => {
      if (Module.onFactoryReset) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onFactoryReset(nid);
      }
    }, 2922: ($0, $1) => {
      if (Module.onUpdateComplete) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onUpdateComplete(nid);
      }
    }, 3033: ($0, $1, $2, $3, $4, $5) => {
      if (Module.onOptionalInteractionRejected) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var src_id = BigInt($2) | BigInt($3) << 32n;
        Module.onOptionalInteractionRejected(nid, src_id, $4, $5);
      }
    }, 3233: ($0, $1, $2, $3, $4, $5) => {
      if (Module.onTerminateDueToError) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var src_id = BigInt($2) | BigInt($3) << 32n;
        Module.onTerminateDueToError(nid, src_id, $4, $5);
      }
    }, 3417: ($0, $1, $2, $3, $4) => {
      if (Module.onVerifiedNodeId) {
        var nid = BigInt($0 >>> 0) | BigInt($1 >>> 0) << 32n;
        var sid = BigInt($2 >>> 0) | BigInt($3 >>> 0) << 32n;
        var alias = $4 & 4095;
        Module.onVerifiedNodeId(nid, sid, alias);
      }
    }, 3632: ($0, $1, $2, $3) => {
      if (Module.onSnipReply) {
        var sid = BigInt($0 >>> 0) | BigInt($1 >>> 0) << 32n;
        var alias = $2 & 4095;
        var msgPtr = $3 >>> 0;
        Module.onSnipReply(sid, alias, msgPtr);
      }
    }, 3807: () => {
      if (Module.on100msTimer) {
        Module.on100msTimer();
      }
    }, 3863: ($0, $1) => {
      if (Module.onLoginComplete) {
        Module.onLoginComplete(BigInt($0) | BigInt($1) << 32n);
      }
    }, 3957: ($0, $1, $2, $3, $4, $5) => {
      if (Module.onConsumedEventIdentified) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onConsumedEventIdentified(nid, $4, eid, $5);
      }
    }, 4143: ($0, $1, $2, $3, $4) => {
      if (Module.onConsumedEventPcer) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onConsumedEventPcer(nid, $4, eid);
      }
    }, 4313: ($0, $1, $2, $3) => {
      if (Module.onEventLearn) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onEventLearn(nid, eid);
      }
    }, 4465: ($0, $1, $2, $3) => {
      if (Module.onConsumerRangeIdentified) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onConsumerRangeIdentified(nid, eid);
      }
    }, 4643: ($0, $1, $2, $3) => {
      if (Module.onConsumerIdentifiedUnknown) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onConsumerIdentifiedUnknown(nid, eid);
      }
    }, 4825: ($0, $1, $2, $3) => {
      if (Module.onConsumerIdentifiedSet) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onConsumerIdentifiedSet(nid, eid);
      }
    }, 4999: ($0, $1, $2, $3) => {
      if (Module.onConsumerIdentifiedClear) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onConsumerIdentifiedClear(nid, eid);
      }
    }, 5177: ($0, $1, $2, $3) => {
      if (Module.onConsumerIdentifiedReserved) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onConsumerIdentifiedReserved(nid, eid);
      }
    }, 5361: ($0, $1, $2, $3) => {
      if (Module.onProducerRangeIdentified) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onProducerRangeIdentified(nid, eid);
      }
    }, 5539: ($0, $1, $2, $3) => {
      if (Module.onProducerIdentifiedUnknown) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onProducerIdentifiedUnknown(nid, eid);
      }
    }, 5721: ($0, $1, $2, $3) => {
      if (Module.onProducerIdentifiedSet) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onProducerIdentifiedSet(nid, eid);
      }
    }, 5895: ($0, $1, $2, $3) => {
      if (Module.onProducerIdentifiedClear) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onProducerIdentifiedClear(nid, eid);
      }
    }, 6073: ($0, $1, $2, $3) => {
      if (Module.onProducerIdentifiedReserved) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onProducerIdentifiedReserved(nid, eid);
      }
    }, 6257: ($0, $1, $2, $3) => {
      if (Module.onPcEventReport) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onPcEventReport(nid, eid);
      }
    }, 6415: ($0, $1, $2, $3, $4, $5) => {
      if (Module.onPcEventReportWithPayload) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var eid = BigInt($2) | BigInt($3) << 32n;
        Module.onPcEventReportWithPayload(nid, eid, $4, $5);
      }
    }, 6603: ($0, $1, $2, $3) => {
      if (Module.onBroadcastTimeChanged) {
        var cid = BigInt($0) | BigInt($1) << 32n;
        Module.onBroadcastTimeChanged(cid, $2, $3);
      }
    }, 6734: ($0, $1, $2, $3, $4, $5) => {
      if (Module.onBroadcastTimeReceived) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var cid = BigInt($2) | BigInt($3) << 32n;
        Module.onBroadcastTimeReceived(nid, cid, $4, $5);
      }
    }, 6916: ($0, $1, $2, $3, $4, $5) => {
      if (Module.onBroadcastDateReceived) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var cid = BigInt($2) | BigInt($3) << 32n;
        Module.onBroadcastDateReceived(nid, cid, $4, $5);
      }
    }, 7098: ($0, $1, $2, $3, $4) => {
      if (Module.onBroadcastYearReceived) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var cid = BigInt($2) | BigInt($3) << 32n;
        Module.onBroadcastYearReceived(nid, cid, $4);
      }
    }, 7276: ($0, $1, $2, $3, $4) => {
      if (Module.onBroadcastRateReceived) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var cid = BigInt($2) | BigInt($3) << 32n;
        Module.onBroadcastRateReceived(nid, cid, $4);
      }
    }, 7454: ($0, $1, $2, $3) => {
      if (Module.onBroadcastClockStarted) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var cid = BigInt($2) | BigInt($3) << 32n;
        Module.onBroadcastClockStarted(nid, cid);
      }
    }, 7628: ($0, $1, $2, $3) => {
      if (Module.onBroadcastClockStopped) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var cid = BigInt($2) | BigInt($3) << 32n;
        Module.onBroadcastClockStopped(nid, cid);
      }
    }, 7802: ($0, $1, $2, $3) => {
      if (Module.onBroadcastDateRollover) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var cid = BigInt($2) | BigInt($3) << 32n;
        Module.onBroadcastDateRollover(nid, cid);
      }
    }, 7976: ($0, $1, $2) => {
      if (Module.onTrainSpeedChanged) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainSpeedChanged(nid, $2);
      }
    }, 8097: ($0, $1, $2, $3) => {
      if (Module.onTrainFunctionChanged) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainFunctionChanged(nid, $2 >>> 0, $3);
      }
    }, 8234: ($0, $1, $2) => {
      if (Module.onTrainEmergencyEntered) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainEmergencyEntered(nid, $2);
      }
    }, 8363: ($0, $1, $2) => {
      if (Module.onTrainEmergencyExited) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainEmergencyExited(nid, $2);
      }
    }, 8490: ($0, $1, $2, $3) => {
      if (Module.onTrainControllerAssigned) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var cid = BigInt($2) | BigInt($3) << 32n;
        Module.onTrainControllerAssigned(nid, cid);
      }
    }, 8668: ($0, $1) => {
      if (Module.onTrainControllerReleased) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainControllerReleased(nid);
      }
    }, 8797: ($0, $1) => {
      if (Module.onTrainListenerChanged) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainListenerChanged(nid);
      }
    }, 8920: ($0, $1) => {
      if (Module.onTrainHeartbeatTimeout) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainHeartbeatTimeout(nid);
      }
    }, 9045: ($0, $1, $2, $3, $4, $5) => {
      if (Module.onTrainControllerAssignRequest) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var curr = BigInt($2) | BigInt($3) << 32n;
        var rq = BigInt($4) | BigInt($5) << 32n;
        return Module.onTrainControllerAssignRequest(nid, curr, rq) ? 1 : 0;
      }
      return 1;
    }, 9307: ($0, $1, $2, $3) => {
      if (Module.onTrainControllerChangedRequest) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var new_ctrl = BigInt($2) | BigInt($3) << 32n;
        return Module.onTrainControllerChangedRequest(nid, new_ctrl) ? 1 : 0;
      }
      return 1;
    }, 9532: ($0, $1, $2, $3, $4, $5) => {
      if (Module.onTrainQuerySpeedsReply) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainQuerySpeedsReply(nid, $2, $3, $4, $5);
      }
    }, 9673: ($0, $1, $2, $3) => {
      if (Module.onTrainQueryFunctionReply) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainQueryFunctionReply(nid, $2 >>> 0, $3);
      }
    }, 9816: ($0, $1, $2, $3, $4) => {
      if (Module.onTrainControllerAssignReply) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var cur = BigInt($3) | BigInt($4) << 32n;
        Module.onTrainControllerAssignReply(nid, $2, cur);
      }
    }, 10004: ($0, $1, $2, $3, $4) => {
      if (Module.onTrainControllerQueryReply) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var cid = BigInt($3) | BigInt($4) << 32n;
        Module.onTrainControllerQueryReply(nid, $2, cid);
      }
    }, 10190: ($0, $1, $2) => {
      if (Module.onTrainControllerChangedNotifyReply) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainControllerChangedNotifyReply(nid, $2);
      }
    }, 10343: ($0, $1, $2, $3, $4) => {
      if (Module.onTrainListenerAttachReply) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var lnode = BigInt($2) | BigInt($3) << 32n;
        Module.onTrainListenerAttachReply(nid, lnode, $4);
      }
    }, 10531: ($0, $1, $2, $3, $4) => {
      if (Module.onTrainListenerDetachReply) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var lnode = BigInt($2) | BigInt($3) << 32n;
        Module.onTrainListenerDetachReply(nid, lnode, $4);
      }
    }, 10719: ($0, $1, $2, $3, $4, $5, $6) => {
      if (Module.onTrainListenerQueryReply) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        var lnode = BigInt($5) | BigInt($6) << 32n;
        Module.onTrainListenerQueryReply(nid, $2, $3, $4, lnode);
      }
    }, 10913: ($0, $1, $2) => {
      if (Module.onTrainReserveReply) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainReserveReply(nid, $2);
      }
    }, 11034: ($0, $1, $2) => {
      if (Module.onTrainHeartbeatRequest) {
        var nid = BigInt($0) | BigInt($1) << 32n;
        Module.onTrainHeartbeatRequest(nid, $2 >>> 0);
      }
    }, 11169: ($0, $1, $2, $3) => {
      if (Module.onTrainSearchMatched) {
        var nid = BigInt($0 >>> 0) | BigInt($1 >>> 0) << 32n;
        var eid = BigInt($2 >>> 0) | BigInt($3 >>> 0) << 32n;
        Module.onTrainSearchMatched(nid, eid);
      }
    }, 11361: ($0, $1) => {
      if (Module.onTrainSearchNoMatch) {
        var eid = BigInt($0 >>> 0) | BigInt($1 >>> 0) << 32n;
        var v = Module.onTrainSearchNoMatch(eid);
        if (typeof v === "bigint") return Number(v);
        if (typeof v === "number") return v;
      }
      return 0;
    }, 11592: ($0, $1, $2, $3, $4) => {
      if (Module.onTrainSearchReply) {
        var sid = BigInt($0 >>> 0) | BigInt($1 >>> 0) << 32n;
        var alias = $2 & 4095;
        var eid = BigInt($3 >>> 0) | BigInt($4 >>> 0) << 32n;
        Module.onTrainSearchReply(sid, alias, eid);
      }
    }, 11811: ($0) => {
      if (Module.onStreamInitiateRequest) {
        return Module.onStreamInitiateRequest($0) ? 1 : 0;
      }
      return 1;
    }, 11916: ($0) => {
      if (Module.onStreamInitiateReply) {
        Module.onStreamInitiateReply($0);
      }
    }, 11992: ($0) => {
      if (Module.onStreamDataReceived) {
        Module.onStreamDataReceived($0);
      }
    }, 12066: ($0) => {
      if (Module.onStreamDataProceed) {
        Module.onStreamDataProceed($0);
      }
    }, 12138: ($0) => {
      if (Module.onStreamComplete) {
        Module.onStreamComplete($0);
      }
    } };
    var _wasm_initialize, _wasm_run, _wasm_100ms_tick, _wasm_rx_gridconnect, _wasm_node_builder_reset, _free, _wasm_node_set_snip, _wasm_node_set_protocol_support, _wasm_node_set_event_autocreate, _wasm_node_set_configuration_options, _wasm_node_set_address_space, _wasm_node_set_cdi, _malloc, _wasm_node_set_fdi, _wasm_create_node, _wasm_send_event_pc_report, _wasm_send_event_with_mti, _wasm_send_teach_event, _wasm_send_initialization_event, _wasm_send_verify_node_id_addressed, _wasm_send_verify_node_id_global, _wasm_send_simple_node_info_request, _wasm_snip_extract_manufacturer_version_id, _wasm_snip_extract_user_version_id, _wasm_snip_extract_name, _wasm_snip_extract_model, _wasm_snip_extract_hardware_version, _wasm_snip_extract_software_version, _wasm_snip_extract_user_name, _wasm_snip_extract_user_description, _wasm_register_consumer_eventid, _wasm_register_producer_eventid, _wasm_clear_consumer_eventids, _wasm_clear_producer_eventids, _wasm_register_consumer_range, _wasm_register_producer_range, _wasm_clear_consumer_ranges, _wasm_clear_producer_ranges, _wasm_bt_is_consumer, _wasm_bt_is_producer, _wasm_bt_start, _wasm_bt_stop, _wasm_bt_send_report_time, _wasm_bt_send_report_date, _wasm_bt_send_report_year, _wasm_bt_send_report_rate, _wasm_bt_send_start, _wasm_bt_send_stop, _wasm_bt_send_date_rollover, _wasm_bt_send_query, _wasm_bt_send_query_reply, _wasm_bt_send_set_time, _wasm_bt_send_set_date, _wasm_bt_send_set_year, _wasm_bt_send_set_rate, _wasm_bt_send_command_start, _wasm_bt_send_command_stop, _wasm_bt_setup_consumer, _wasm_bt_setup_producer, _wasm_bt_trigger_query_reply, _wasm_bt_trigger_sync_delay, _wasm_bt_make_clock_id, _wasm_bt_is_time_event, _wasm_bt_extract_clock_id, _wasm_bt_get_event_type, _wasm_bt_extract_time, _wasm_bt_extract_date, _wasm_bt_extract_year, _wasm_bt_extract_rate, _wasm_bt_create_time_event_id, _wasm_bt_create_date_event_id, _wasm_bt_create_year_event_id, _wasm_bt_create_rate_event_id, _wasm_bt_create_command_event_id, _wasm_train_send_emergency_stop, _wasm_train_send_query_speeds, _wasm_train_send_assign_controller, _wasm_train_send_release_controller, _wasm_train_send_noop, _wasm_train_send_set_speed, _wasm_train_send_set_function, _wasm_train_send_query_function, _wasm_train_setup, _wasm_train_set_dcc_address, _wasm_train_get_dcc_address, _wasm_train_is_long_address, _wasm_train_set_speed_steps, _wasm_train_get_speed_steps, _wasm_train_set_heartbeat_timeout, _wasm_train_get_heartbeat_timeout, _wasm_train_send_query_controller, _wasm_train_send_reserve, _wasm_train_send_release_reserve, _wasm_train_send_controller_changing_notify, _wasm_train_send_listener_detach, _wasm_train_send_listener_attach, _wasm_train_send_listener_query, _wasm_train_get_reserved_by_node_id, _wasm_train_get_listener_count, _wasm_train_get_listener_at, _wasm_dcc_encode_event_id, _wasm_dcc_make_short_address, _wasm_dcc_make_consist_address, _wasm_dcc_extract_direction, _wasm_dcc_extract_address_type, _wasm_dcc_extract_raw_address, _wasm_dcc_extract_dcc_address, _wasm_dcc_extract_detector_id, _wasm_dcc_is_track_empty, _wasm_util_generate_event_range_id, _wasm_util_alias_for_node_id, _wasm_util_is_producer_event_assigned, _wasm_util_is_consumer_event_assigned, _wasm_util_is_event_in_producer_ranges, _wasm_util_is_event_in_consumer_ranges, _wasm_float16_from_float, _wasm_float16_to_float, _wasm_float16_negate, _wasm_float16_is_nan, _wasm_float16_is_zero, _wasm_float16_speed_with_direction, _wasm_float16_get_speed, _wasm_float16_get_direction, _wasm_train_search_is_search_event, _wasm_train_search_extract_flags, _wasm_train_search_extract_digits, _wasm_train_search_digits_to_address, _wasm_train_search_create_event_id, _wasm_train_send_search_match, __emscripten_stack_restore, __emscripten_stack_alloc, _emscripten_stack_get_current, memory, __indirect_function_table, wasmMemory;
    function assignWasmExports(wasmExports2) {
      _wasm_initialize = Module["_wasm_initialize"] = wasmExports2["wasm_initialize"];
      _wasm_run = Module["_wasm_run"] = wasmExports2["wasm_run"];
      _wasm_100ms_tick = Module["_wasm_100ms_tick"] = wasmExports2["wasm_100ms_tick"];
      _wasm_rx_gridconnect = Module["_wasm_rx_gridconnect"] = wasmExports2["wasm_rx_gridconnect"];
      _wasm_node_builder_reset = Module["_wasm_node_builder_reset"] = wasmExports2["wasm_node_builder_reset"];
      _free = Module["_free"] = wasmExports2["free"];
      _wasm_node_set_snip = Module["_wasm_node_set_snip"] = wasmExports2["wasm_node_set_snip"];
      _wasm_node_set_protocol_support = Module["_wasm_node_set_protocol_support"] = wasmExports2["wasm_node_set_protocol_support"];
      _wasm_node_set_event_autocreate = Module["_wasm_node_set_event_autocreate"] = wasmExports2["wasm_node_set_event_autocreate"];
      _wasm_node_set_configuration_options = Module["_wasm_node_set_configuration_options"] = wasmExports2["wasm_node_set_configuration_options"];
      _wasm_node_set_address_space = Module["_wasm_node_set_address_space"] = wasmExports2["wasm_node_set_address_space"];
      _wasm_node_set_cdi = Module["_wasm_node_set_cdi"] = wasmExports2["wasm_node_set_cdi"];
      _malloc = Module["_malloc"] = wasmExports2["malloc"];
      _wasm_node_set_fdi = Module["_wasm_node_set_fdi"] = wasmExports2["wasm_node_set_fdi"];
      _wasm_create_node = Module["_wasm_create_node"] = wasmExports2["wasm_create_node"];
      _wasm_send_event_pc_report = Module["_wasm_send_event_pc_report"] = wasmExports2["wasm_send_event_pc_report"];
      _wasm_send_event_with_mti = Module["_wasm_send_event_with_mti"] = wasmExports2["wasm_send_event_with_mti"];
      _wasm_send_teach_event = Module["_wasm_send_teach_event"] = wasmExports2["wasm_send_teach_event"];
      _wasm_send_initialization_event = Module["_wasm_send_initialization_event"] = wasmExports2["wasm_send_initialization_event"];
      _wasm_send_verify_node_id_addressed = Module["_wasm_send_verify_node_id_addressed"] = wasmExports2["wasm_send_verify_node_id_addressed"];
      _wasm_send_verify_node_id_global = Module["_wasm_send_verify_node_id_global"] = wasmExports2["wasm_send_verify_node_id_global"];
      _wasm_send_simple_node_info_request = Module["_wasm_send_simple_node_info_request"] = wasmExports2["wasm_send_simple_node_info_request"];
      _wasm_snip_extract_manufacturer_version_id = Module["_wasm_snip_extract_manufacturer_version_id"] = wasmExports2["wasm_snip_extract_manufacturer_version_id"];
      _wasm_snip_extract_user_version_id = Module["_wasm_snip_extract_user_version_id"] = wasmExports2["wasm_snip_extract_user_version_id"];
      _wasm_snip_extract_name = Module["_wasm_snip_extract_name"] = wasmExports2["wasm_snip_extract_name"];
      _wasm_snip_extract_model = Module["_wasm_snip_extract_model"] = wasmExports2["wasm_snip_extract_model"];
      _wasm_snip_extract_hardware_version = Module["_wasm_snip_extract_hardware_version"] = wasmExports2["wasm_snip_extract_hardware_version"];
      _wasm_snip_extract_software_version = Module["_wasm_snip_extract_software_version"] = wasmExports2["wasm_snip_extract_software_version"];
      _wasm_snip_extract_user_name = Module["_wasm_snip_extract_user_name"] = wasmExports2["wasm_snip_extract_user_name"];
      _wasm_snip_extract_user_description = Module["_wasm_snip_extract_user_description"] = wasmExports2["wasm_snip_extract_user_description"];
      _wasm_register_consumer_eventid = Module["_wasm_register_consumer_eventid"] = wasmExports2["wasm_register_consumer_eventid"];
      _wasm_register_producer_eventid = Module["_wasm_register_producer_eventid"] = wasmExports2["wasm_register_producer_eventid"];
      _wasm_clear_consumer_eventids = Module["_wasm_clear_consumer_eventids"] = wasmExports2["wasm_clear_consumer_eventids"];
      _wasm_clear_producer_eventids = Module["_wasm_clear_producer_eventids"] = wasmExports2["wasm_clear_producer_eventids"];
      _wasm_register_consumer_range = Module["_wasm_register_consumer_range"] = wasmExports2["wasm_register_consumer_range"];
      _wasm_register_producer_range = Module["_wasm_register_producer_range"] = wasmExports2["wasm_register_producer_range"];
      _wasm_clear_consumer_ranges = Module["_wasm_clear_consumer_ranges"] = wasmExports2["wasm_clear_consumer_ranges"];
      _wasm_clear_producer_ranges = Module["_wasm_clear_producer_ranges"] = wasmExports2["wasm_clear_producer_ranges"];
      _wasm_bt_is_consumer = Module["_wasm_bt_is_consumer"] = wasmExports2["wasm_bt_is_consumer"];
      _wasm_bt_is_producer = Module["_wasm_bt_is_producer"] = wasmExports2["wasm_bt_is_producer"];
      _wasm_bt_start = Module["_wasm_bt_start"] = wasmExports2["wasm_bt_start"];
      _wasm_bt_stop = Module["_wasm_bt_stop"] = wasmExports2["wasm_bt_stop"];
      _wasm_bt_send_report_time = Module["_wasm_bt_send_report_time"] = wasmExports2["wasm_bt_send_report_time"];
      _wasm_bt_send_report_date = Module["_wasm_bt_send_report_date"] = wasmExports2["wasm_bt_send_report_date"];
      _wasm_bt_send_report_year = Module["_wasm_bt_send_report_year"] = wasmExports2["wasm_bt_send_report_year"];
      _wasm_bt_send_report_rate = Module["_wasm_bt_send_report_rate"] = wasmExports2["wasm_bt_send_report_rate"];
      _wasm_bt_send_start = Module["_wasm_bt_send_start"] = wasmExports2["wasm_bt_send_start"];
      _wasm_bt_send_stop = Module["_wasm_bt_send_stop"] = wasmExports2["wasm_bt_send_stop"];
      _wasm_bt_send_date_rollover = Module["_wasm_bt_send_date_rollover"] = wasmExports2["wasm_bt_send_date_rollover"];
      _wasm_bt_send_query = Module["_wasm_bt_send_query"] = wasmExports2["wasm_bt_send_query"];
      _wasm_bt_send_query_reply = Module["_wasm_bt_send_query_reply"] = wasmExports2["wasm_bt_send_query_reply"];
      _wasm_bt_send_set_time = Module["_wasm_bt_send_set_time"] = wasmExports2["wasm_bt_send_set_time"];
      _wasm_bt_send_set_date = Module["_wasm_bt_send_set_date"] = wasmExports2["wasm_bt_send_set_date"];
      _wasm_bt_send_set_year = Module["_wasm_bt_send_set_year"] = wasmExports2["wasm_bt_send_set_year"];
      _wasm_bt_send_set_rate = Module["_wasm_bt_send_set_rate"] = wasmExports2["wasm_bt_send_set_rate"];
      _wasm_bt_send_command_start = Module["_wasm_bt_send_command_start"] = wasmExports2["wasm_bt_send_command_start"];
      _wasm_bt_send_command_stop = Module["_wasm_bt_send_command_stop"] = wasmExports2["wasm_bt_send_command_stop"];
      _wasm_bt_setup_consumer = Module["_wasm_bt_setup_consumer"] = wasmExports2["wasm_bt_setup_consumer"];
      _wasm_bt_setup_producer = Module["_wasm_bt_setup_producer"] = wasmExports2["wasm_bt_setup_producer"];
      _wasm_bt_trigger_query_reply = Module["_wasm_bt_trigger_query_reply"] = wasmExports2["wasm_bt_trigger_query_reply"];
      _wasm_bt_trigger_sync_delay = Module["_wasm_bt_trigger_sync_delay"] = wasmExports2["wasm_bt_trigger_sync_delay"];
      _wasm_bt_make_clock_id = Module["_wasm_bt_make_clock_id"] = wasmExports2["wasm_bt_make_clock_id"];
      _wasm_bt_is_time_event = Module["_wasm_bt_is_time_event"] = wasmExports2["wasm_bt_is_time_event"];
      _wasm_bt_extract_clock_id = Module["_wasm_bt_extract_clock_id"] = wasmExports2["wasm_bt_extract_clock_id"];
      _wasm_bt_get_event_type = Module["_wasm_bt_get_event_type"] = wasmExports2["wasm_bt_get_event_type"];
      _wasm_bt_extract_time = Module["_wasm_bt_extract_time"] = wasmExports2["wasm_bt_extract_time"];
      _wasm_bt_extract_date = Module["_wasm_bt_extract_date"] = wasmExports2["wasm_bt_extract_date"];
      _wasm_bt_extract_year = Module["_wasm_bt_extract_year"] = wasmExports2["wasm_bt_extract_year"];
      _wasm_bt_extract_rate = Module["_wasm_bt_extract_rate"] = wasmExports2["wasm_bt_extract_rate"];
      _wasm_bt_create_time_event_id = Module["_wasm_bt_create_time_event_id"] = wasmExports2["wasm_bt_create_time_event_id"];
      _wasm_bt_create_date_event_id = Module["_wasm_bt_create_date_event_id"] = wasmExports2["wasm_bt_create_date_event_id"];
      _wasm_bt_create_year_event_id = Module["_wasm_bt_create_year_event_id"] = wasmExports2["wasm_bt_create_year_event_id"];
      _wasm_bt_create_rate_event_id = Module["_wasm_bt_create_rate_event_id"] = wasmExports2["wasm_bt_create_rate_event_id"];
      _wasm_bt_create_command_event_id = Module["_wasm_bt_create_command_event_id"] = wasmExports2["wasm_bt_create_command_event_id"];
      _wasm_train_send_emergency_stop = Module["_wasm_train_send_emergency_stop"] = wasmExports2["wasm_train_send_emergency_stop"];
      _wasm_train_send_query_speeds = Module["_wasm_train_send_query_speeds"] = wasmExports2["wasm_train_send_query_speeds"];
      _wasm_train_send_assign_controller = Module["_wasm_train_send_assign_controller"] = wasmExports2["wasm_train_send_assign_controller"];
      _wasm_train_send_release_controller = Module["_wasm_train_send_release_controller"] = wasmExports2["wasm_train_send_release_controller"];
      _wasm_train_send_noop = Module["_wasm_train_send_noop"] = wasmExports2["wasm_train_send_noop"];
      _wasm_train_send_set_speed = Module["_wasm_train_send_set_speed"] = wasmExports2["wasm_train_send_set_speed"];
      _wasm_train_send_set_function = Module["_wasm_train_send_set_function"] = wasmExports2["wasm_train_send_set_function"];
      _wasm_train_send_query_function = Module["_wasm_train_send_query_function"] = wasmExports2["wasm_train_send_query_function"];
      _wasm_train_setup = Module["_wasm_train_setup"] = wasmExports2["wasm_train_setup"];
      _wasm_train_set_dcc_address = Module["_wasm_train_set_dcc_address"] = wasmExports2["wasm_train_set_dcc_address"];
      _wasm_train_get_dcc_address = Module["_wasm_train_get_dcc_address"] = wasmExports2["wasm_train_get_dcc_address"];
      _wasm_train_is_long_address = Module["_wasm_train_is_long_address"] = wasmExports2["wasm_train_is_long_address"];
      _wasm_train_set_speed_steps = Module["_wasm_train_set_speed_steps"] = wasmExports2["wasm_train_set_speed_steps"];
      _wasm_train_get_speed_steps = Module["_wasm_train_get_speed_steps"] = wasmExports2["wasm_train_get_speed_steps"];
      _wasm_train_set_heartbeat_timeout = Module["_wasm_train_set_heartbeat_timeout"] = wasmExports2["wasm_train_set_heartbeat_timeout"];
      _wasm_train_get_heartbeat_timeout = Module["_wasm_train_get_heartbeat_timeout"] = wasmExports2["wasm_train_get_heartbeat_timeout"];
      _wasm_train_send_query_controller = Module["_wasm_train_send_query_controller"] = wasmExports2["wasm_train_send_query_controller"];
      _wasm_train_send_reserve = Module["_wasm_train_send_reserve"] = wasmExports2["wasm_train_send_reserve"];
      _wasm_train_send_release_reserve = Module["_wasm_train_send_release_reserve"] = wasmExports2["wasm_train_send_release_reserve"];
      _wasm_train_send_controller_changing_notify = Module["_wasm_train_send_controller_changing_notify"] = wasmExports2["wasm_train_send_controller_changing_notify"];
      _wasm_train_send_listener_detach = Module["_wasm_train_send_listener_detach"] = wasmExports2["wasm_train_send_listener_detach"];
      _wasm_train_send_listener_attach = Module["_wasm_train_send_listener_attach"] = wasmExports2["wasm_train_send_listener_attach"];
      _wasm_train_send_listener_query = Module["_wasm_train_send_listener_query"] = wasmExports2["wasm_train_send_listener_query"];
      _wasm_train_get_reserved_by_node_id = Module["_wasm_train_get_reserved_by_node_id"] = wasmExports2["wasm_train_get_reserved_by_node_id"];
      _wasm_train_get_listener_count = Module["_wasm_train_get_listener_count"] = wasmExports2["wasm_train_get_listener_count"];
      _wasm_train_get_listener_at = Module["_wasm_train_get_listener_at"] = wasmExports2["wasm_train_get_listener_at"];
      _wasm_dcc_encode_event_id = Module["_wasm_dcc_encode_event_id"] = wasmExports2["wasm_dcc_encode_event_id"];
      _wasm_dcc_make_short_address = Module["_wasm_dcc_make_short_address"] = wasmExports2["wasm_dcc_make_short_address"];
      _wasm_dcc_make_consist_address = Module["_wasm_dcc_make_consist_address"] = wasmExports2["wasm_dcc_make_consist_address"];
      _wasm_dcc_extract_direction = Module["_wasm_dcc_extract_direction"] = wasmExports2["wasm_dcc_extract_direction"];
      _wasm_dcc_extract_address_type = Module["_wasm_dcc_extract_address_type"] = wasmExports2["wasm_dcc_extract_address_type"];
      _wasm_dcc_extract_raw_address = Module["_wasm_dcc_extract_raw_address"] = wasmExports2["wasm_dcc_extract_raw_address"];
      _wasm_dcc_extract_dcc_address = Module["_wasm_dcc_extract_dcc_address"] = wasmExports2["wasm_dcc_extract_dcc_address"];
      _wasm_dcc_extract_detector_id = Module["_wasm_dcc_extract_detector_id"] = wasmExports2["wasm_dcc_extract_detector_id"];
      _wasm_dcc_is_track_empty = Module["_wasm_dcc_is_track_empty"] = wasmExports2["wasm_dcc_is_track_empty"];
      _wasm_util_generate_event_range_id = Module["_wasm_util_generate_event_range_id"] = wasmExports2["wasm_util_generate_event_range_id"];
      _wasm_util_alias_for_node_id = Module["_wasm_util_alias_for_node_id"] = wasmExports2["wasm_util_alias_for_node_id"];
      _wasm_util_is_producer_event_assigned = Module["_wasm_util_is_producer_event_assigned"] = wasmExports2["wasm_util_is_producer_event_assigned"];
      _wasm_util_is_consumer_event_assigned = Module["_wasm_util_is_consumer_event_assigned"] = wasmExports2["wasm_util_is_consumer_event_assigned"];
      _wasm_util_is_event_in_producer_ranges = Module["_wasm_util_is_event_in_producer_ranges"] = wasmExports2["wasm_util_is_event_in_producer_ranges"];
      _wasm_util_is_event_in_consumer_ranges = Module["_wasm_util_is_event_in_consumer_ranges"] = wasmExports2["wasm_util_is_event_in_consumer_ranges"];
      _wasm_float16_from_float = Module["_wasm_float16_from_float"] = wasmExports2["wasm_float16_from_float"];
      _wasm_float16_to_float = Module["_wasm_float16_to_float"] = wasmExports2["wasm_float16_to_float"];
      _wasm_float16_negate = Module["_wasm_float16_negate"] = wasmExports2["wasm_float16_negate"];
      _wasm_float16_is_nan = Module["_wasm_float16_is_nan"] = wasmExports2["wasm_float16_is_nan"];
      _wasm_float16_is_zero = Module["_wasm_float16_is_zero"] = wasmExports2["wasm_float16_is_zero"];
      _wasm_float16_speed_with_direction = Module["_wasm_float16_speed_with_direction"] = wasmExports2["wasm_float16_speed_with_direction"];
      _wasm_float16_get_speed = Module["_wasm_float16_get_speed"] = wasmExports2["wasm_float16_get_speed"];
      _wasm_float16_get_direction = Module["_wasm_float16_get_direction"] = wasmExports2["wasm_float16_get_direction"];
      _wasm_train_search_is_search_event = Module["_wasm_train_search_is_search_event"] = wasmExports2["wasm_train_search_is_search_event"];
      _wasm_train_search_extract_flags = Module["_wasm_train_search_extract_flags"] = wasmExports2["wasm_train_search_extract_flags"];
      _wasm_train_search_extract_digits = Module["_wasm_train_search_extract_digits"] = wasmExports2["wasm_train_search_extract_digits"];
      _wasm_train_search_digits_to_address = Module["_wasm_train_search_digits_to_address"] = wasmExports2["wasm_train_search_digits_to_address"];
      _wasm_train_search_create_event_id = Module["_wasm_train_search_create_event_id"] = wasmExports2["wasm_train_search_create_event_id"];
      _wasm_train_send_search_match = Module["_wasm_train_send_search_match"] = wasmExports2["wasm_train_send_search_match"];
      __emscripten_stack_restore = wasmExports2["_emscripten_stack_restore"];
      __emscripten_stack_alloc = wasmExports2["_emscripten_stack_alloc"];
      _emscripten_stack_get_current = wasmExports2["emscripten_stack_get_current"];
      memory = wasmMemory = wasmExports2["memory"];
      __indirect_function_table = wasmExports2["__indirect_function_table"];
    }
    var wasmImports = { __assert_fail: ___assert_fail, emscripten_asm_const_double: _emscripten_asm_const_double, emscripten_asm_const_int: _emscripten_asm_const_int, emscripten_resize_heap: _emscripten_resize_heap };
    function run() {
      preRun();
      function doRun() {
        Module["calledRun"] = true;
        if (ABORT) return;
        initRuntime();
        readyPromiseResolve?.(Module);
        Module["onRuntimeInitialized"]?.();
        postRun();
      }
      if (Module["setStatus"]) {
        Module["setStatus"]("Running...");
        setTimeout(() => {
          setTimeout(() => Module["setStatus"](""), 1);
          doRun();
        }, 1);
      } else {
        doRun();
      }
    }
    var wasmExports;
    wasmExports = await createWasm();
    run();
    if (runtimeInitialized) {
      moduleRtn = Module;
    } else {
      moduleRtn = new Promise((resolve, reject) => {
        readyPromiseResolve = resolve;
        readyPromiseReject = reject;
      });
    }
    ;
    return moduleRtn;
  }
  var openlcb_core_default = OpenLcbCoreFactory;

  // src/openlcb/errors.js
  var OpenLcbError = class extends Error {
    constructor(message, { cause } = {}) {
      super(message);
      this.name = this.constructor.name;
      if (cause !== void 0) this.cause = cause;
    }
  };
  var InvalidArgumentError = class extends OpenLcbError {
  };
  var PoolFullError = class extends OpenLcbError {
  };
  var UnknownNodeError = class extends OpenLcbError {
  };
  var TransportBusyError = class extends OpenLcbError {
  };
  var NotInitializedError = class extends OpenLcbError {
  };
  var ProtocolNotSupportedError = class extends OpenLcbError {
  };
  var WasmLoadError = class extends OpenLcbError {
  };
  var TransportConnectError = class extends OpenLcbError {
  };
  function errorForReturnCode(rc, context) {
    if (rc >= 0) return null;
    switch (rc) {
      case -1:
        return new InvalidArgumentError(`${context}: invalid argument`);
      case -2:
        return new PoolFullError(`${context}: pool ceiling exceeded`);
      case -3:
        return new UnknownNodeError(`${context}: unknown node`);
      case -4:
        return new TransportBusyError(`${context}: transport TX busy`);
      case -5:
        return new NotInitializedError(`${context}: wasm_initialize not called`);
      default:
        return new OpenLcbError(`${context}: unknown WASM error code ${rc}`);
    }
  }

  // wasm/openlcb-defines.mjs
  var ADDRESS_SPACE_IN_BYTE_1 = 0;
  var ADDRESS_SPACE_IN_BYTE_6 = 1;
  var BASIC = 0;
  var BROADCAST_TIME_DATE_ROLLOVER = 61443;
  var BROADCAST_TIME_EVENT_DATE_ROLLOVER = 11;
  var BROADCAST_TIME_EVENT_QUERY = 8;
  var BROADCAST_TIME_EVENT_REPORT_DATE = 1;
  var BROADCAST_TIME_EVENT_REPORT_RATE = 3;
  var BROADCAST_TIME_EVENT_REPORT_TIME = 0;
  var BROADCAST_TIME_EVENT_REPORT_YEAR = 2;
  var BROADCAST_TIME_EVENT_SET_DATE = 5;
  var BROADCAST_TIME_EVENT_SET_RATE = 7;
  var BROADCAST_TIME_EVENT_SET_TIME = 4;
  var BROADCAST_TIME_EVENT_SET_YEAR = 6;
  var BROADCAST_TIME_EVENT_START = 10;
  var BROADCAST_TIME_EVENT_STOP = 9;
  var BROADCAST_TIME_EVENT_UNKNOWN = 255;
  var BROADCAST_TIME_ID_ALTERNATE_CLOCK_1 = 72339069031546880n;
  var BROADCAST_TIME_ID_ALTERNATE_CLOCK_2 = 72339069031612416n;
  var BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK = 72339069031415808n;
  var BROADCAST_TIME_ID_DEFAULT_REALTIME_CLOCK = 72339069031481344n;
  var BROADCAST_TIME_QUERY = 61440;
  var BROADCAST_TIME_START = 61442;
  var BROADCAST_TIME_STOP = 61441;
  var CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS = 252;
  var CONFIG_MEM_SPACE_ACDI_USER_ACCESS = 251;
  var CONFIG_MEM_SPACE_ALL = 254;
  var CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO = 255;
  var CONFIG_MEM_SPACE_CONFIGURATION_MEMORY = 253;
  var CONFIG_MEM_SPACE_FIRMWARE = 239;
  var CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY = 249;
  var CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO = 250;
  var CONFIG_MEM_STREAM_PHASE_ALLOCATED = 1;
  var CONFIG_MEM_STREAM_PHASE_IDLE = 0;
  var CONFIG_MEM_STREAM_PHASE_PUMPING = 4;
  var CONFIG_MEM_STREAM_PHASE_SEND_COMPLETE = 5;
  var CONFIG_MEM_STREAM_PHASE_SEND_REPLY_DATAGRAM = 3;
  var CONFIG_MEM_STREAM_PHASE_WAIT_INITIATE_REPLY = 2;
  var CONFIG_MEM_STREAM_PHASE_WRITE_RECEIVING = 7;
  var CONFIG_MEM_STREAM_PHASE_WRITE_SEND_REPLY = 8;
  var CONFIG_MEM_STREAM_PHASE_WRITE_WAIT_STREAM_INITIATE = 6;
  var DATAGRAM = 1;
  var EVENT_ID_CBUS_OFF_SPACE = 72340168526266368n;
  var EVENT_ID_CBUS_ON_SPACE = 72340172821233664n;
  var EVENT_ID_CLEAR_EMERGENCY_OFF = 72057594037993470n;
  var EVENT_ID_CLEAR_EMERGENCY_STOP = 72057594037993468n;
  var EVENT_ID_DCC_ACCESSORY_ACTIVATE = 72341268054605824n;
  var EVENT_ID_DCC_ACCESSORY_DEACTIVATE = 72341268054540288n;
  var EVENT_ID_DCC_EXTENDED_ACCESSORY_CMD_SPACE = 72341268054671615n;
  var EVENT_ID_DCC_SENSOR_FEEDBACK_HIGH = 72341268054343680n;
  var EVENT_ID_DCC_SENSOR_FEEDBACK_LO = 72341268054278144n;
  var EVENT_ID_DCC_TURNOUT_FEEDBACK_HIGH = 72341268054474752n;
  var EVENT_ID_DCC_TURNOUT_FEEDBACK_LOW = 72341268054409216n;
  var EVENT_ID_DUPLICATE_NODE_DETECTED = 72339069014639105n;
  var EVENT_ID_EMERGENCY_OFF = 72057594037993471n;
  var EVENT_ID_EMERGENCY_STOP = 72057594037993469n;
  var EVENT_ID_FIRMWARE_CORRUPTED = 72339069014640129n;
  var EVENT_ID_FIRMWARE_UPGRADE_BY_HARDWARE_SWITCH = 72339069014640130n;
  var EVENT_ID_IDENT_BUTTON_COMBO_PRESSED = 72057594037993216n;
  var EVENT_ID_LINK_ERROR_CODE_1 = 72057594037993217n;
  var EVENT_ID_LINK_ERROR_CODE_2 = 72057594037993218n;
  var EVENT_ID_LINK_ERROR_CODE_3 = 72057594037993219n;
  var EVENT_ID_LINK_ERROR_CODE_4 = 72057594037993220n;
  var EVENT_ID_NODE_RECORDED_NEW_LOG = 72057594037993464n;
  var EVENT_ID_POWER_SUPPLY_BROWN_OUT_NODE = 72057594037993457n;
  var EVENT_ID_POWER_SUPPLY_BROWN_OUT_STANDARD = 72057594037993456n;
  var EVENT_ID_TRAIN = 72339069014639363n;
  var EVENT_ID_TRAIN_PROXY = 72339069014639364n;
  var EVENT_RANGE_COUNT_1 = 0;
  var EVENT_RANGE_COUNT_1024 = 10;
  var EVENT_RANGE_COUNT_1048576 = 20;
  var EVENT_RANGE_COUNT_1073741824 = 30;
  var EVENT_RANGE_COUNT_128 = 7;
  var EVENT_RANGE_COUNT_131072 = 17;
  var EVENT_RANGE_COUNT_134217728 = 27;
  var EVENT_RANGE_COUNT_16 = 4;
  var EVENT_RANGE_COUNT_16384 = 14;
  var EVENT_RANGE_COUNT_16777216 = 24;
  var EVENT_RANGE_COUNT_2 = 1;
  var EVENT_RANGE_COUNT_2048 = 11;
  var EVENT_RANGE_COUNT_2097152 = 21;
  var EVENT_RANGE_COUNT_2147483648 = 31;
  var EVENT_RANGE_COUNT_256 = 8;
  var EVENT_RANGE_COUNT_262144 = 18;
  var EVENT_RANGE_COUNT_268435456 = 28;
  var EVENT_RANGE_COUNT_32 = 5;
  var EVENT_RANGE_COUNT_32768 = 15;
  var EVENT_RANGE_COUNT_33554432 = 25;
  var EVENT_RANGE_COUNT_4 = 2;
  var EVENT_RANGE_COUNT_4096 = 12;
  var EVENT_RANGE_COUNT_4194304 = 22;
  var EVENT_RANGE_COUNT_4294967296 = 32;
  var EVENT_RANGE_COUNT_512 = 9;
  var EVENT_RANGE_COUNT_524288 = 19;
  var EVENT_RANGE_COUNT_536870912 = 29;
  var EVENT_RANGE_COUNT_64 = 6;
  var EVENT_RANGE_COUNT_65536 = 16;
  var EVENT_RANGE_COUNT_67108864 = 26;
  var EVENT_RANGE_COUNT_8 = 3;
  var EVENT_RANGE_COUNT_8192 = 13;
  var EVENT_RANGE_COUNT_8388608 = 23;
  var EVENT_STATUS_CLEAR = 2;
  var EVENT_STATUS_SET = 1;
  var EVENT_STATUS_UNKNOWN = 0;
  var MTI_CONSUMER_IDENTIFIED_CLEAR = 1221;
  var MTI_CONSUMER_IDENTIFIED_RESERVED = 1222;
  var MTI_CONSUMER_IDENTIFIED_SET = 1220;
  var MTI_CONSUMER_IDENTIFIED_UNKNOWN = 1223;
  var MTI_CONSUMER_IDENTIFY = 2292;
  var MTI_CONSUMER_RANGE_IDENTIFIED = 1188;
  var MTI_DATAGRAM = 7240;
  var MTI_DATAGRAM_OK_REPLY = 2600;
  var MTI_DATAGRAM_REJECTED_REPLY = 2632;
  var MTI_EVENTS_IDENTIFY = 2416;
  var MTI_EVENTS_IDENTIFY_DEST = 2408;
  var MTI_EVENT_LEARN = 1428;
  var MTI_INITIALIZATION_COMPLETE = 256;
  var MTI_INITIALIZATION_COMPLETE_SIMPLE = 257;
  var MTI_OPTIONAL_INTERACTION_REJECTED = 104;
  var MTI_PC_EVENT_REPORT = 1460;
  var MTI_PC_EVENT_REPORT_WITH_PAYLOAD = 3860;
  var MTI_PRODUCER_IDENTIFIED_CLEAR = 1349;
  var MTI_PRODUCER_IDENTIFIED_RESERVED = 1350;
  var MTI_PRODUCER_IDENTIFIED_SET = 1348;
  var MTI_PRODUCER_IDENTIFIED_UNKNOWN = 1351;
  var MTI_PRODUCER_IDENTIFY = 2324;
  var MTI_PRODUCER_RANGE_IDENTIFIED = 1316;
  var MTI_PROTOCOL_SUPPORT_INQUIRY = 2088;
  var MTI_PROTOCOL_SUPPORT_REPLY = 1640;
  var MTI_SIMPLE_NODE_INFO_REPLY = 2568;
  var MTI_SIMPLE_NODE_INFO_REQUEST = 3560;
  var MTI_SIMPLE_TRAIN_INFO_REPLY = 2504;
  var MTI_SIMPLE_TRAIN_INFO_REQUEST = 3496;
  var MTI_STREAM_COMPLETE = 2216;
  var MTI_STREAM_INIT_REPLY = 2152;
  var MTI_STREAM_INIT_REQUEST = 3272;
  var MTI_STREAM_PROCEED = 2184;
  var MTI_STREAM_SEND = 8072;
  var MTI_TERMINATE_DUE_TO_ERROR = 168;
  var MTI_TRAIN_PROTOCOL = 1515;
  var MTI_TRAIN_REPLY = 489;
  var MTI_VERIFIED_NODE_ID = 368;
  var MTI_VERIFIED_NODE_ID_SIMPLE = 369;
  var MTI_VERIFY_NODE_ID_ADDRESSED = 1160;
  var MTI_VERIFY_NODE_ID_GLOBAL = 1168;
  var OPENLCB_C_LIB_VERSION = "1.1.0";
  var OPENLCB_C_LIB_VERSION_MAJOR = 1;
  var OPENLCB_C_LIB_VERSION_MINOR = 1;
  var OPENLCB_C_LIB_VERSION_PATCH = 0;
  var PSI_ABBREVIATED_DEFAULT_CDI = 16384;
  var PSI_CONFIGURATION_DESCRIPTION_INFO = 2048;
  var PSI_DATAGRAM = 4194304;
  var PSI_DISPLAY = 8192;
  var PSI_EVENT_EXCHANGE = 262144;
  var PSI_FIRMWARE_UPGRADE = 32;
  var PSI_FIRMWARE_UPGRADE_ACTIVE = 16;
  var PSI_FUNCTION_CONFIGURATION = 64;
  var PSI_FUNCTION_DESCRIPTION = 512;
  var PSI_IDENTIFICATION = 131072;
  var PSI_MEMORY_CONFIGURATION = 1048576;
  var PSI_REMOTE_BUTTON = 32768;
  var PSI_RESERVATION = 524288;
  var PSI_SIMPLE = 8388608;
  var PSI_SIMPLE_NODE_INFORMATION = 4096;
  var PSI_STREAM = 2097152;
  var PSI_TEACHING_LEARNING = 65536;
  var PSI_TRAIN_CONTROL = 1024;
  var SNIP = 2;
  var STREAM = 3;
  var STREAM_STATE_CLOSED = 0;
  var STREAM_STATE_INITIATED = 1;
  var STREAM_STATE_OPEN = 2;
  var TRAIN_EMERGENCY_TYPE_ESTOP = 0;
  var TRAIN_EMERGENCY_TYPE_GLOBAL_OFF = 2;
  var TRAIN_EMERGENCY_TYPE_GLOBAL_STOP = 1;
  var TRAIN_SEARCH_DCC_SPEED_STEPS_128 = 3;
  var TRAIN_SEARCH_DCC_SPEED_STEPS_14 = 1;
  var TRAIN_SEARCH_DCC_SPEED_STEPS_28 = 2;
  var TRAIN_SEARCH_DCC_SPEED_STEPS_DEFAULT = 0;
  var TRAIN_SEARCH_FLAG_ADDRESS_ONLY = 32;
  var TRAIN_SEARCH_FLAG_ALLOCATE = 128;
  var TRAIN_SEARCH_FLAG_EXACT = 64;
  var TRAIN_SEARCH_FLAG_LONG_ADDR = 4;
  var TRAIN_SEARCH_PROTOCOL_ANY = 0;
  var TRAIN_SEARCH_PROTOCOL_FAMILY_DCC = 8;
  var TRAIN_SEARCH_PROTOCOL_FAMILY_NATIVE = 0;
  var TRAIN_SEARCH_PROTOCOL_MFX = 2;
  var TRAIN_SEARCH_PROTOCOL_MM_ANY = 4;
  var TRAIN_SEARCH_PROTOCOL_MM_V1 = 5;
  var TRAIN_SEARCH_PROTOCOL_MM_V2 = 6;
  var TRAIN_SEARCH_PROTOCOL_MM_V2_EXTENDED = 7;
  var TRAIN_SEARCH_PROTOCOL_OPENLCB_NATIVE = 1;
  var USER_DEFINED_BASIC_BUFFER_DEPTH = 255;
  var USER_DEFINED_CONSUMER_COUNT = 256;
  var USER_DEFINED_CONSUMER_RANGE_COUNT = 32;
  var USER_DEFINED_DATAGRAM_BUFFER_DEPTH = 64;
  var USER_DEFINED_MAX_CONCURRENT_ACTIVE_STREAMS = 64;
  var USER_DEFINED_MAX_LISTENERS_PER_TRAIN = 16;
  var USER_DEFINED_MAX_TRAIN_FUNCTIONS = 29;
  var USER_DEFINED_NODE_BUFFER_DEPTH = 255;
  var USER_DEFINED_PRODUCER_COUNT = 256;
  var USER_DEFINED_PRODUCER_RANGE_COUNT = 32;
  var USER_DEFINED_SNIP_BUFFER_DEPTH = 64;
  var USER_DEFINED_STREAM_BUFFER_DEPTH = 64;
  var USER_DEFINED_STREAM_BUFFER_LEN = 1024;
  var USER_DEFINED_TRAIN_NODE_COUNT = 255;
  var WORKER = 4;
  var dcc_detector_address_consist = 2;
  var dcc_detector_address_long = 0;
  var dcc_detector_address_short = 1;
  var dcc_detector_address_track_empty = 3;
  var dcc_detector_occupied_forward = 1;
  var dcc_detector_occupied_reverse = 2;
  var dcc_detector_occupied_unknown = 3;
  var dcc_detector_unoccupied = 0;
  var broadcast_time_event_type_enum = Object.freeze({
    BROADCAST_TIME_EVENT_REPORT_TIME,
    BROADCAST_TIME_EVENT_REPORT_DATE,
    BROADCAST_TIME_EVENT_REPORT_YEAR,
    BROADCAST_TIME_EVENT_REPORT_RATE,
    BROADCAST_TIME_EVENT_SET_TIME,
    BROADCAST_TIME_EVENT_SET_DATE,
    BROADCAST_TIME_EVENT_SET_YEAR,
    BROADCAST_TIME_EVENT_SET_RATE,
    BROADCAST_TIME_EVENT_QUERY,
    BROADCAST_TIME_EVENT_STOP,
    BROADCAST_TIME_EVENT_START,
    BROADCAST_TIME_EVENT_DATE_ROLLOVER,
    BROADCAST_TIME_EVENT_UNKNOWN
  });
  var config_mem_stream_phase_enum = Object.freeze({
    CONFIG_MEM_STREAM_PHASE_IDLE,
    CONFIG_MEM_STREAM_PHASE_ALLOCATED,
    CONFIG_MEM_STREAM_PHASE_WAIT_INITIATE_REPLY,
    CONFIG_MEM_STREAM_PHASE_SEND_REPLY_DATAGRAM,
    CONFIG_MEM_STREAM_PHASE_PUMPING,
    CONFIG_MEM_STREAM_PHASE_SEND_COMPLETE,
    CONFIG_MEM_STREAM_PHASE_WRITE_WAIT_STREAM_INITIATE,
    CONFIG_MEM_STREAM_PHASE_WRITE_RECEIVING,
    CONFIG_MEM_STREAM_PHASE_WRITE_SEND_REPLY
  });
  var dcc_detector_address_type_enum = Object.freeze({
    dcc_detector_address_long,
    dcc_detector_address_short,
    dcc_detector_address_consist,
    dcc_detector_address_track_empty
  });
  var dcc_detector_direction_enum = Object.freeze({
    dcc_detector_unoccupied,
    dcc_detector_occupied_forward,
    dcc_detector_occupied_reverse,
    dcc_detector_occupied_unknown
  });
  var event_range_count_enum = Object.freeze({
    EVENT_RANGE_COUNT_1,
    EVENT_RANGE_COUNT_2,
    EVENT_RANGE_COUNT_4,
    EVENT_RANGE_COUNT_8,
    EVENT_RANGE_COUNT_16,
    EVENT_RANGE_COUNT_32,
    EVENT_RANGE_COUNT_64,
    EVENT_RANGE_COUNT_128,
    EVENT_RANGE_COUNT_256,
    EVENT_RANGE_COUNT_512,
    EVENT_RANGE_COUNT_1024,
    EVENT_RANGE_COUNT_2048,
    EVENT_RANGE_COUNT_4096,
    EVENT_RANGE_COUNT_8192,
    EVENT_RANGE_COUNT_16384,
    EVENT_RANGE_COUNT_32768,
    EVENT_RANGE_COUNT_65536,
    EVENT_RANGE_COUNT_131072,
    EVENT_RANGE_COUNT_262144,
    EVENT_RANGE_COUNT_524288,
    EVENT_RANGE_COUNT_1048576,
    EVENT_RANGE_COUNT_2097152,
    EVENT_RANGE_COUNT_4194304,
    EVENT_RANGE_COUNT_8388608,
    EVENT_RANGE_COUNT_16777216,
    EVENT_RANGE_COUNT_33554432,
    EVENT_RANGE_COUNT_67108864,
    EVENT_RANGE_COUNT_134217728,
    EVENT_RANGE_COUNT_268435456,
    EVENT_RANGE_COUNT_536870912,
    EVENT_RANGE_COUNT_1073741824,
    EVENT_RANGE_COUNT_2147483648,
    EVENT_RANGE_COUNT_4294967296
  });
  var event_status_enum = Object.freeze({
    EVENT_STATUS_UNKNOWN,
    EVENT_STATUS_SET,
    EVENT_STATUS_CLEAR
  });
  var payload_type_enum = Object.freeze({
    BASIC,
    DATAGRAM,
    SNIP,
    STREAM,
    WORKER
  });
  var space_encoding_enum = Object.freeze({
    ADDRESS_SPACE_IN_BYTE_1,
    ADDRESS_SPACE_IN_BYTE_6
  });
  var stream_state_enum = Object.freeze({
    STREAM_STATE_CLOSED,
    STREAM_STATE_INITIATED,
    STREAM_STATE_OPEN
  });
  var train_emergency_type_enum = Object.freeze({
    TRAIN_EMERGENCY_TYPE_ESTOP,
    TRAIN_EMERGENCY_TYPE_GLOBAL_STOP,
    TRAIN_EMERGENCY_TYPE_GLOBAL_OFF
  });

  // src/openlcb/constants.js
  var PSI = Object.freeze({
    SIMPLE: PSI_SIMPLE,
    DATAGRAM: PSI_DATAGRAM,
    STREAM: PSI_STREAM,
    MEMORY_CONFIGURATION: PSI_MEMORY_CONFIGURATION,
    RESERVATION: PSI_RESERVATION,
    EVENT_EXCHANGE: PSI_EVENT_EXCHANGE,
    IDENTIFICATION: PSI_IDENTIFICATION,
    TEACHING_LEARNING: PSI_TEACHING_LEARNING,
    REMOTE_BUTTON: PSI_REMOTE_BUTTON,
    ABBREVIATED_DEFAULT_CDI: PSI_ABBREVIATED_DEFAULT_CDI,
    DISPLAY: PSI_DISPLAY,
    SIMPLE_NODE_INFORMATION: PSI_SIMPLE_NODE_INFORMATION,
    CONFIGURATION_DESCRIPTION_INFO: PSI_CONFIGURATION_DESCRIPTION_INFO,
    TRAIN_CONTROL: PSI_TRAIN_CONTROL,
    FUNCTION_DESCRIPTION: PSI_FUNCTION_DESCRIPTION,
    FUNCTION_CONFIGURATION: PSI_FUNCTION_CONFIGURATION,
    FIRMWARE_UPGRADE: PSI_FIRMWARE_UPGRADE,
    FIRMWARE_UPGRADE_ACTIVE: PSI_FIRMWARE_UPGRADE_ACTIVE
  });
  var MTI = Object.freeze({
    INITIALIZATION_COMPLETE: MTI_INITIALIZATION_COMPLETE,
    INITIALIZATION_COMPLETE_SIMPLE: MTI_INITIALIZATION_COMPLETE_SIMPLE,
    VERIFY_NODE_ID_GLOBAL: MTI_VERIFY_NODE_ID_GLOBAL,
    VERIFY_NODE_ID_ADDRESSED: MTI_VERIFY_NODE_ID_ADDRESSED,
    VERIFIED_NODE_ID: MTI_VERIFIED_NODE_ID,
    VERIFIED_NODE_ID_SIMPLE: MTI_VERIFIED_NODE_ID_SIMPLE,
    OPTIONAL_INTERACTION_REJECTED: MTI_OPTIONAL_INTERACTION_REJECTED,
    TERMINATE_DUE_TO_ERROR: MTI_TERMINATE_DUE_TO_ERROR,
    PROTOCOL_SUPPORT_INQUIRY: MTI_PROTOCOL_SUPPORT_INQUIRY,
    PROTOCOL_SUPPORT_REPLY: MTI_PROTOCOL_SUPPORT_REPLY,
    SIMPLE_NODE_INFO_REQUEST: MTI_SIMPLE_NODE_INFO_REQUEST,
    SIMPLE_NODE_INFO_REPLY: MTI_SIMPLE_NODE_INFO_REPLY,
    SIMPLE_TRAIN_INFO_REQUEST: MTI_SIMPLE_TRAIN_INFO_REQUEST,
    SIMPLE_TRAIN_INFO_REPLY: MTI_SIMPLE_TRAIN_INFO_REPLY,
    // Event Transport
    CONSUMER_IDENTIFY: MTI_CONSUMER_IDENTIFY,
    CONSUMER_IDENTIFIED_SET: MTI_CONSUMER_IDENTIFIED_SET,
    CONSUMER_IDENTIFIED_CLEAR: MTI_CONSUMER_IDENTIFIED_CLEAR,
    CONSUMER_IDENTIFIED_RESERVED: MTI_CONSUMER_IDENTIFIED_RESERVED,
    CONSUMER_IDENTIFIED_UNKNOWN: MTI_CONSUMER_IDENTIFIED_UNKNOWN,
    CONSUMER_RANGE_IDENTIFIED: MTI_CONSUMER_RANGE_IDENTIFIED,
    PRODUCER_IDENTIFY: MTI_PRODUCER_IDENTIFY,
    PRODUCER_IDENTIFIED_SET: MTI_PRODUCER_IDENTIFIED_SET,
    PRODUCER_IDENTIFIED_CLEAR: MTI_PRODUCER_IDENTIFIED_CLEAR,
    PRODUCER_IDENTIFIED_RESERVED: MTI_PRODUCER_IDENTIFIED_RESERVED,
    PRODUCER_IDENTIFIED_UNKNOWN: MTI_PRODUCER_IDENTIFIED_UNKNOWN,
    PRODUCER_RANGE_IDENTIFIED: MTI_PRODUCER_RANGE_IDENTIFIED,
    EVENTS_IDENTIFY: MTI_EVENTS_IDENTIFY,
    EVENTS_IDENTIFY_DEST: MTI_EVENTS_IDENTIFY_DEST,
    EVENT_LEARN: MTI_EVENT_LEARN,
    PC_EVENT_REPORT: MTI_PC_EVENT_REPORT,
    PC_EVENT_REPORT_WITH_PAYLOAD: MTI_PC_EVENT_REPORT_WITH_PAYLOAD,
    // Streams + Datagrams
    STREAM_INIT_REQUEST: MTI_STREAM_INIT_REQUEST,
    STREAM_INIT_REPLY: MTI_STREAM_INIT_REPLY,
    STREAM_COMPLETE: MTI_STREAM_COMPLETE,
    STREAM_PROCEED: MTI_STREAM_PROCEED,
    STREAM_SEND: MTI_STREAM_SEND,
    DATAGRAM: MTI_DATAGRAM,
    DATAGRAM_OK_REPLY: MTI_DATAGRAM_OK_REPLY,
    DATAGRAM_REJECTED_REPLY: MTI_DATAGRAM_REJECTED_REPLY,
    // Train control
    TRAIN_PROTOCOL: MTI_TRAIN_PROTOCOL,
    TRAIN_REPLY: MTI_TRAIN_REPLY
  });
  var AddressSpace = Object.freeze({
    CONFIGURATION_DEFINITION_INFO: CONFIG_MEM_SPACE_CONFIGURATION_DEFINITION_INFO,
    // 0xFF
    ALL: CONFIG_MEM_SPACE_ALL,
    // 0xFE
    CONFIGURATION_MEMORY: CONFIG_MEM_SPACE_CONFIGURATION_MEMORY,
    // 0xFD
    ACDI_MANUFACTURER_ACCESS: CONFIG_MEM_SPACE_ACDI_MANUFACTURER_ACCESS,
    // 0xFC
    ACDI_USER_ACCESS: CONFIG_MEM_SPACE_ACDI_USER_ACCESS,
    // 0xFB
    TRAIN_FUNCTION_DEFINITION_INFO: CONFIG_MEM_SPACE_TRAIN_FUNCTION_DEFINITION_INFO,
    // 0xFA
    TRAIN_FUNCTION_CONFIGURATION_MEMORY: CONFIG_MEM_SPACE_TRAIN_FUNCTION_CONFIGURATION_MEMORY,
    // 0xF9
    FIRMWARE: CONFIG_MEM_SPACE_FIRMWARE
    // 0xEF
  });
  var TrainSearchFlag = Object.freeze({
    ADDRESS_ONLY: TRAIN_SEARCH_FLAG_ADDRESS_ONLY,
    ALLOCATE: TRAIN_SEARCH_FLAG_ALLOCATE,
    EXACT: TRAIN_SEARCH_FLAG_EXACT,
    LONG_ADDR: TRAIN_SEARCH_FLAG_LONG_ADDR
  });
  var TrainSearchSpeedSteps = Object.freeze({
    DEFAULT: TRAIN_SEARCH_DCC_SPEED_STEPS_DEFAULT,
    // 0
    STEPS_14: TRAIN_SEARCH_DCC_SPEED_STEPS_14,
    // 1
    STEPS_28: TRAIN_SEARCH_DCC_SPEED_STEPS_28,
    // 2
    STEPS_128: TRAIN_SEARCH_DCC_SPEED_STEPS_128
    // 3
  });
  var TrainSearchProtocol = Object.freeze({
    ANY: TRAIN_SEARCH_PROTOCOL_ANY,
    OPENLCB_NATIVE: TRAIN_SEARCH_PROTOCOL_OPENLCB_NATIVE,
    MFX: TRAIN_SEARCH_PROTOCOL_MFX,
    MM_ANY: TRAIN_SEARCH_PROTOCOL_MM_ANY,
    MM_V1: TRAIN_SEARCH_PROTOCOL_MM_V1,
    MM_V2: TRAIN_SEARCH_PROTOCOL_MM_V2,
    MM_V2_EXTENDED: TRAIN_SEARCH_PROTOCOL_MM_V2_EXTENDED,
    FAMILY_NATIVE: TRAIN_SEARCH_PROTOCOL_FAMILY_NATIVE,
    FAMILY_DCC: TRAIN_SEARCH_PROTOCOL_FAMILY_DCC
  });
  var BroadcastTimeClock = Object.freeze({
    DEFAULT_FAST: BROADCAST_TIME_ID_DEFAULT_FAST_CLOCK,
    DEFAULT_REALTIME: BROADCAST_TIME_ID_DEFAULT_REALTIME_CLOCK,
    ALTERNATE_1: BROADCAST_TIME_ID_ALTERNATE_CLOCK_1,
    ALTERNATE_2: BROADCAST_TIME_ID_ALTERNATE_CLOCK_2
  });
  var BroadcastTimeCommand = Object.freeze({
    QUERY: BROADCAST_TIME_QUERY,
    STOP: BROADCAST_TIME_STOP,
    START: BROADCAST_TIME_START,
    DATE_ROLLOVER: BROADCAST_TIME_DATE_ROLLOVER
  });
  var Event = Object.freeze({
    EMERGENCY_STOP: EVENT_ID_EMERGENCY_STOP,
    EMERGENCY_OFF: EVENT_ID_EMERGENCY_OFF,
    CLEAR_EMERGENCY_STOP: EVENT_ID_CLEAR_EMERGENCY_STOP,
    CLEAR_EMERGENCY_OFF: EVENT_ID_CLEAR_EMERGENCY_OFF,
    IS_TRAIN: EVENT_ID_TRAIN,
    IS_TRAIN_PROXY: EVENT_ID_TRAIN_PROXY,
    DUPLICATE_NODE_DETECTED: EVENT_ID_DUPLICATE_NODE_DETECTED,
    FIRMWARE_CORRUPTED: EVENT_ID_FIRMWARE_CORRUPTED,
    FIRMWARE_UPGRADE_BY_HW_SWITCH: EVENT_ID_FIRMWARE_UPGRADE_BY_HARDWARE_SWITCH,
    NODE_RECORDED_NEW_LOG: EVENT_ID_NODE_RECORDED_NEW_LOG,
    POWER_BROWN_OUT_NODE: EVENT_ID_POWER_SUPPLY_BROWN_OUT_NODE,
    POWER_BROWN_OUT_STANDARD: EVENT_ID_POWER_SUPPLY_BROWN_OUT_STANDARD,
    IDENT_BUTTON_COMBO_PRESSED: EVENT_ID_IDENT_BUTTON_COMBO_PRESSED,
    // Link layer error codes
    LINK_ERROR_CODE_1: EVENT_ID_LINK_ERROR_CODE_1,
    LINK_ERROR_CODE_2: EVENT_ID_LINK_ERROR_CODE_2,
    LINK_ERROR_CODE_3: EVENT_ID_LINK_ERROR_CODE_3,
    LINK_ERROR_CODE_4: EVENT_ID_LINK_ERROR_CODE_4,
    // CBUS bridge event spaces (range bases)
    CBUS_OFF_SPACE: EVENT_ID_CBUS_OFF_SPACE,
    CBUS_ON_SPACE: EVENT_ID_CBUS_ON_SPACE,
    // DCC accessory / sensor / turnout / extended event spaces (range bases).
    // Note the spelling: SENSOR_FEEDBACK_LO matches the C define exactly
    // (no trailing 'W'), distinct from TURNOUT_FEEDBACK_LOW.
    DCC_ACCESSORY_ACTIVATE: EVENT_ID_DCC_ACCESSORY_ACTIVATE,
    DCC_ACCESSORY_DEACTIVATE: EVENT_ID_DCC_ACCESSORY_DEACTIVATE,
    DCC_TURNOUT_FEEDBACK_HIGH: EVENT_ID_DCC_TURNOUT_FEEDBACK_HIGH,
    DCC_TURNOUT_FEEDBACK_LOW: EVENT_ID_DCC_TURNOUT_FEEDBACK_LOW,
    DCC_SENSOR_FEEDBACK_HIGH: EVENT_ID_DCC_SENSOR_FEEDBACK_HIGH,
    DCC_SENSOR_FEEDBACK_LO: EVENT_ID_DCC_SENSOR_FEEDBACK_LO,
    DCC_EXTENDED_ACCESSORY_CMD_SPACE: EVENT_ID_DCC_EXTENDED_ACCESSORY_CMD_SPACE
  });
  var Version = Object.freeze({
    C_LIB: OPENLCB_C_LIB_VERSION,
    C_LIB_MAJOR: OPENLCB_C_LIB_VERSION_MAJOR,
    C_LIB_MINOR: OPENLCB_C_LIB_VERSION_MINOR,
    C_LIB_PATCH: OPENLCB_C_LIB_VERSION_PATCH
  });
  var Limits = Object.freeze({
    MAX_NODES: USER_DEFINED_NODE_BUFFER_DEPTH,
    MAX_PRODUCERS_PER_NODE: USER_DEFINED_PRODUCER_COUNT,
    MAX_PRODUCER_RANGES_PER_NODE: USER_DEFINED_PRODUCER_RANGE_COUNT,
    MAX_CONSUMERS_PER_NODE: USER_DEFINED_CONSUMER_COUNT,
    MAX_CONSUMER_RANGES_PER_NODE: USER_DEFINED_CONSUMER_RANGE_COUNT,
    MAX_TRAIN_NODES: USER_DEFINED_TRAIN_NODE_COUNT,
    MAX_LISTENERS_PER_TRAIN: USER_DEFINED_MAX_LISTENERS_PER_TRAIN,
    MAX_TRAIN_FUNCTIONS: USER_DEFINED_MAX_TRAIN_FUNCTIONS,
    MAX_CONCURRENT_STREAMS: USER_DEFINED_MAX_CONCURRENT_ACTIVE_STREAMS,
    STREAM_BUFFER_LEN: USER_DEFINED_STREAM_BUFFER_LEN,
    BASIC_BUFFER_DEPTH: USER_DEFINED_BASIC_BUFFER_DEPTH,
    DATAGRAM_BUFFER_DEPTH: USER_DEFINED_DATAGRAM_BUFFER_DEPTH,
    SNIP_BUFFER_DEPTH: USER_DEFINED_SNIP_BUFFER_DEPTH,
    STREAM_BUFFER_DEPTH: USER_DEFINED_STREAM_BUFFER_DEPTH
  });
  var EventStatus = event_status_enum;
  var EventRangeCount = event_range_count_enum;
  var TrainEmergencyType = train_emergency_type_enum;
  var BroadcastTimeEventType = broadcast_time_event_type_enum;
  var DccDetectorDirection = dcc_detector_direction_enum;
  var DccDetectorAddressType = dcc_detector_address_type_enum;
  var StreamState = stream_state_enum;
  var ConfigMemStreamPhase = config_mem_stream_phase_enum;
  var SpaceEncoding = space_encoding_enum;
  var PayloadType = payload_type_enum;

  // src/openlcb/internals/params.js
  var ADDR_SPACE_FLAG_PRESENT = 1;
  var ADDR_SPACE_FLAG_READ_ONLY = 2;
  var ADDR_SPACE_FLAG_LOW_ADDRESS_VALID = 4;
  var CFG_OPT_WRITE_UNDER_MASK = 1 << 0;
  var CFG_OPT_UNALIGNED_READS = 1 << 1;
  var CFG_OPT_UNALIGNED_WRITES = 1 << 2;
  var CFG_OPT_READ_FROM_MFG_SPACE_0xFC = 1 << 3;
  var CFG_OPT_READ_FROM_USER_SPACE_0xFB = 1 << 4;
  var CFG_OPT_WRITE_TO_USER_SPACE_0xFB = 1 << 5;
  var CFG_OPT_STREAM_READ_WRITE = 1 << 6;
  var ADDRESS_SPACE_KEYS = Object.freeze({
    addressSpaceConfigurationDefinitionInfo: AddressSpace.CONFIGURATION_DEFINITION_INFO,
    addressSpaceAll: AddressSpace.ALL,
    addressSpaceConfigMemory: AddressSpace.CONFIGURATION_MEMORY,
    addressSpaceAcdiManufacturer: AddressSpace.ACDI_MANUFACTURER_ACCESS,
    addressSpaceAcdiUser: AddressSpace.ACDI_USER_ACCESS,
    addressSpaceTrainFunctionDefinitionInfo: AddressSpace.TRAIN_FUNCTION_DEFINITION_INFO,
    addressSpaceTrainFunctionConfigMemory: AddressSpace.TRAIN_FUNCTION_CONFIGURATION_MEMORY,
    addressSpaceFirmware: AddressSpace.FIRMWARE
  });
  function _stageBytes(api, source, setter, name) {
    if (source == null) return;
    const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
    if (!(bytes instanceof Uint8Array)) {
      throw new InvalidArgumentError(
        `${name} must be a Uint8Array or string, got ${typeof source}`
      );
    }
    if (bytes.length === 0) return;
    const ptr = api.malloc(bytes.length);
    if (!ptr) {
      throw new InvalidArgumentError(
        `malloc failed staging ${bytes.length} ${name} bytes`
      );
    }
    try {
      api.HEAPU8.set(bytes, ptr);
      const rc = setter(ptr, bytes.length);
      if (rc !== 0) {
        throw new InvalidArgumentError(
          `wasm_node_set_${name} rejected ${bytes.length} bytes (rc=${rc})`
        );
      }
    } finally {
      api.free(ptr);
    }
  }
  function foldProtocolSupport(ps) {
    if (ps === void 0 || ps === null) return 0n;
    if (Array.isArray(ps)) {
      let out = 0n;
      for (const bit of ps) out |= BigInt(bit);
      return out;
    }
    return BigInt(ps);
  }
  function buildAndCreateNode(api, id, params) {
    const p = params ?? {};
    api.builderReset();
    const snip = p.snip ?? {};
    if (snip.mfgVersion !== void 0 && snip.mfgVersion !== 4) {
      throw new InvalidArgumentError(
        `snip.mfgVersion must be 4 (string count fixed by SNIP spec); got ${snip.mfgVersion}`
      );
    }
    if (snip.userVersion !== void 0 && snip.userVersion !== 2) {
      throw new InvalidArgumentError(
        `snip.userVersion must be 2 (string count fixed by SNIP spec); got ${snip.userVersion}`
      );
    }
    api.setSnip(
      snip.mfgVersion ?? 4,
      snip.name ?? "",
      snip.model ?? "",
      snip.hardwareVersion ?? "",
      snip.softwareVersion ?? "",
      snip.userVersion ?? 2
    );
    const ps = foldProtocolSupport(p.protocolSupport);
    api.setProtocolSupport(
      Number(ps & 0xFFFFFFFFn),
      Number(ps >> 32n & 0xFFFFFFFFn)
    );
    api.setEventAutocreate(
      p.producerCountAutocreate ?? 0,
      p.consumerCountAutocreate ?? 0
    );
    const co = p.configurationOptions ?? {};
    let coFlags = 0;
    if (co.writeUnderMaskSupported) coFlags |= CFG_OPT_WRITE_UNDER_MASK;
    if (co.unalignedReadsSupported) coFlags |= CFG_OPT_UNALIGNED_READS;
    if (co.unalignedWritesSupported) coFlags |= CFG_OPT_UNALIGNED_WRITES;
    if (co.readFromManufacturerSpace0xfcSupported) coFlags |= CFG_OPT_READ_FROM_MFG_SPACE_0xFC;
    if (co.readFromUserSpace0xfbSupported) coFlags |= CFG_OPT_READ_FROM_USER_SPACE_0xFB;
    if (co.writeToUserSpace0xfbSupported) coFlags |= CFG_OPT_WRITE_TO_USER_SPACE_0xFB;
    if (co.streamReadWriteSupported) coFlags |= CFG_OPT_STREAM_READ_WRITE;
    api.setConfigurationOptions(
      coFlags,
      co.highestAddressSpace ?? 0,
      co.lowestAddressSpace ?? 0,
      co.description ?? ""
    );
    _stageBytes(api, p.cdi, api.setCdi, "cdi");
    _stageBytes(api, p.fdi, api.setFdi, "fdi");
    for (const [key, spaceId] of Object.entries(ADDRESS_SPACE_KEYS)) {
      const spec = p[key];
      if (!spec) continue;
      let flags = 0;
      if (spec.present) flags |= ADDR_SPACE_FLAG_PRESENT;
      if (spec.readOnly) flags |= ADDR_SPACE_FLAG_READ_ONLY;
      if (spec.lowAddressValid) flags |= ADDR_SPACE_FLAG_LOW_ADDRESS_VALID;
      const rc2 = api.setAddressSpace(
        spaceId,
        flags,
        spec.lowAddress ?? 0,
        spec.highestAddress ?? 0,
        spec.description ?? ""
      );
      if (rc2 !== 0) {
        throw new InvalidArgumentError(
          `addressSpace ${key} (id=${spaceId}) rejected by WASM (rc=${rc2})`
        );
      }
    }
    const rc = api.createNode(id);
    const err = errorForReturnCode(rc, `wasm_create_node(${id.toString(16)})`);
    if (err) throw err;
    if (ps & BigInt(PSI.TRAIN_CONTROL)) {
      const rc2 = api.tSetup(id);
      const err2 = errorForReturnCode(rc2, `wasm_train_setup(${id.toString(16)})`);
      if (err2) throw err2;
    }
  }
  function resolveParameters(params) {
    const p = params ?? {};
    return Object.freeze({
      snip: Object.freeze({
        mfgVersion: p.snip?.mfgVersion ?? 4,
        name: p.snip?.name ?? "",
        model: p.snip?.model ?? "",
        hardwareVersion: p.snip?.hardwareVersion ?? "",
        softwareVersion: p.snip?.softwareVersion ?? "",
        userVersion: p.snip?.userVersion ?? 2
      }),
      protocolSupport: foldProtocolSupport(p.protocolSupport),
      producerCountAutocreate: p.producerCountAutocreate ?? 0,
      consumerCountAutocreate: p.consumerCountAutocreate ?? 0,
      configurationOptions: Object.freeze({ ...p.configurationOptions ?? {} }),
      // Echo back whatever addressSpace* keys the caller set.
      ...Object.fromEntries(
        Object.keys(ADDRESS_SPACE_KEYS).filter((k) => p[k]).map((k) => [k, Object.freeze({ ...p[k] })])
      )
    });
  }

  // src/openlcb/node.js
  var TrainFacade = class {
    constructor(node, api) {
      this._node = node;
      this._api = api;
    }
    /** Throws if the LOCAL node isn't configured as a train (Group B methods). */
    _checkIsTrain() {
      if (!(this._node.parameters.protocolSupport & BigInt(PSI.TRAIN_CONTROL))) {
        throw new ProtocolNotSupportedError(
          "this method requires the local node to declare PSI.TRAIN_CONTROL \u2014 throttle-side sends (Group A) work without it; only train-side state setters and sendSearchMatch (Group B) require it"
        );
      }
    }
    // --- Group A: Throttle-side commands (send to remote train) -------------
    // No PSI.TRAIN_CONTROL check on the local node — a throttle issuing
    // commands to a remote train is not itself a train.
    sendAssignController(trainAlias, trainId) {
      _throwIfError(
        this._api.tAssign(this._node.id, trainAlias | 0, BigInt(trainId)),
        "train.sendAssignController"
      );
    }
    sendReleaseController(trainAlias, trainId) {
      _throwIfError(
        this._api.tRelease(this._node.id, trainAlias | 0, BigInt(trainId)),
        "train.sendReleaseController"
      );
    }
    sendEmergencyStop(trainAlias, trainId) {
      _throwIfError(
        this._api.tEstop(this._node.id, trainAlias | 0, BigInt(trainId)),
        "train.sendEmergencyStop"
      );
    }
    sendQuerySpeeds(trainAlias, trainId) {
      _throwIfError(
        this._api.tQSpeeds(this._node.id, trainAlias | 0, BigInt(trainId)),
        "train.sendQuerySpeeds"
      );
    }
    sendNoop(trainAlias, trainId) {
      _throwIfError(
        this._api.tNoop(this._node.id, trainAlias | 0, BigInt(trainId)),
        "train.sendNoop"
      );
    }
    sendSetSpeed(trainAlias, trainId, speedF16) {
      _throwIfError(
        this._api.tSetSpeed(this._node.id, trainAlias | 0, BigInt(trainId), speedF16 | 0),
        "train.sendSetSpeed"
      );
    }
    sendSetFunction(trainAlias, trainId, fnAddress, fnValue) {
      _throwIfError(
        this._api.tSetFunction(this._node.id, trainAlias | 0, BigInt(trainId), fnAddress >>> 0, fnValue | 0),
        "train.sendSetFunction"
      );
    }
    sendQueryFunction(trainAlias, trainId, fnAddress) {
      _throwIfError(
        this._api.tQueryFunction(this._node.id, trainAlias | 0, BigInt(trainId), fnAddress >>> 0),
        "train.sendQueryFunction"
      );
    }
    sendQueryController(trainAlias, trainId) {
      _throwIfError(
        this._api.tQueryController(this._node.id, trainAlias | 0, BigInt(trainId)),
        "train.sendQueryController"
      );
    }
    sendReserve(trainAlias, trainId) {
      _throwIfError(
        this._api.tReserve(this._node.id, trainAlias | 0, BigInt(trainId)),
        "train.sendReserve"
      );
    }
    sendReleaseReserve(trainAlias, trainId) {
      _throwIfError(
        this._api.tReleaseReserve(this._node.id, trainAlias | 0, BigInt(trainId)),
        "train.sendReleaseReserve"
      );
    }
    sendControllerChangingNotify(trainAlias, trainId, newControllerNodeId) {
      _throwIfError(
        this._api.tControllerChangingNotify(this._node.id, trainAlias | 0, BigInt(trainId), BigInt(newControllerNodeId)),
        "train.sendControllerChangingNotify"
      );
    }
    sendListenerAttach(trainAlias, trainId, listenerNodeId, flags = 0) {
      _throwIfError(
        this._api.tListenerAttach(this._node.id, trainAlias | 0, BigInt(trainId), BigInt(listenerNodeId), flags | 0),
        "train.sendListenerAttach"
      );
    }
    sendListenerDetach(trainAlias, trainId, listenerNodeId) {
      _throwIfError(
        this._api.tListenerDetach(this._node.id, trainAlias | 0, BigInt(trainId), BigInt(listenerNodeId)),
        "train.sendListenerDetach"
      );
    }
    sendListenerQuery(trainAlias, trainId, listenerIndex) {
      _throwIfError(
        this._api.tListenerQuery(this._node.id, trainAlias | 0, BigInt(trainId), listenerIndex | 0),
        "train.sendListenerQuery"
      );
    }
    // --- Group B: Train-side / per-train state ------------------------------
    // These require the local node to declare PSI.TRAIN_CONTROL — they
    // either reply on behalf of the train (sendSearchMatch) or read/write
    // the train_state struct that train_setup() allocates.
    sendSearchMatch(searchEventId) {
      this._checkIsTrain();
      _throwIfError(
        this._api.tSendSearchMatch(this._node.id, BigInt(searchEventId)),
        "train.sendSearchMatch"
      );
    }
    setDccAddress(dccAddress, isLong) {
      this._checkIsTrain();
      _throwIfError(
        this._api.tSetDcc(this._node.id, dccAddress >>> 0, isLong ? 1 : 0),
        "train.setDccAddress"
      );
    }
    getDccAddress() {
      this._checkIsTrain();
      return this._api.tGetDcc(this._node.id);
    }
    isLongAddress() {
      this._checkIsTrain();
      return this._api.tIsLong(this._node.id) === 1;
    }
    setSpeedSteps(steps) {
      this._checkIsTrain();
      _throwIfError(
        this._api.tSetSteps(this._node.id, steps | 0),
        "train.setSpeedSteps"
      );
    }
    getSpeedSteps() {
      this._checkIsTrain();
      return this._api.tGetSteps(this._node.id);
    }
    /**
     * Configure the heartbeat-monitor deadline.  Per TrainControlS §6.6, the
     * train fires Heartbeat Request to its assigned controller; if the
     * controller does not reply within the deadline, the train behaves as
     * if the controller sent Set Speed 0 (preserving direction) and forwards
     * that to all registered listeners.  Pass 0 to disable.
     *
     * @param {number} seconds  Reply deadline in seconds; 0 to disable.
     */
    setHeartbeatTimeout(seconds) {
      this._checkIsTrain();
      _throwIfError(
        this._api.tSetHeartbeat(this._node.id, seconds >>> 0),
        "train.setHeartbeatTimeout"
      );
    }
    getHeartbeatTimeout() {
      this._checkIsTrain();
      return this._api.tGetHeartbeat(this._node.id);
    }
    /**
     * Returns the Node ID currently holding this train's reservation, or 0n
     * if no reservation is held.  Per TrainControlS §6.x a train may be
     * reserved by a single controller via the Train Control Management
     * Reserve sub-command; this getter exposes that state to application UI.
     *
     * @return {bigint} Reserving controller's Node ID, or 0n if unreserved.
     */
    getReservedByNodeId() {
      this._checkIsTrain();
      return this._api.tGetReserved(this._node.id);
    }
    /**
     * Returns the count of listeners currently attached to this train.
     * Listeners are attached/detached by remote throttles via the Listener
     * Configuration sub-commands (TrainControlS §6.5); this getter lets local
     * application code surface the consist roster without round-tripping a
     * Listener Query message on the wire.
     *
     * @return {number} Listener count (0 to USER_DEFINED_MAX_LISTENERS_PER_TRAIN).
     */
    getListenerCount() {
      this._checkIsTrain();
      const n = this._api.tGetListenerCount(this._node.id);
      return n < 0 ? 0 : n;
    }
    /**
     * Reads one entry from this train's listener list.  Index zero through
     * (getListenerCount() - 1) returns entries in attach order.  Returns
     * null when the index is out of range.
     *
     * @param {number} index  Zero-based listener slot.
     * @return {{nodeId: bigint, flags: number} | null}
     */
    getListenerAt(index) {
      this._checkIsTrain();
      const buf = this._api.malloc(9);
      if (!buf) return null;
      try {
        const rc = this._api.tGetListenerAt(this._node.id, index >>> 0, buf);
        if (rc !== 0) return null;
        const heap = this._api.HEAPU8;
        let nodeId = 0n;
        for (let i = 7; i >= 0; i--) {
          nodeId = nodeId << 8n | BigInt(heap[buf + i]);
        }
        const flags = heap[buf + 8];
        return { nodeId, flags };
      } finally {
        this._api.free(buf);
      }
    }
  };
  var BroadcastTimeFacade = class {
    constructor(node, api) {
      this._node = node;
      this._api = api;
    }
    // Per-clock setup.  Required before any send/receive on a given clock.
    setupConsumer(clockId) {
      _throwIfError(
        this._api.btSetupConsumer(this._node.id, BigInt(clockId)),
        "broadcastTime.setupConsumer"
      );
    }
    setupProducer(clockId) {
      _throwIfError(
        this._api.btSetupProducer(this._node.id, BigInt(clockId)),
        "broadcastTime.setupProducer"
      );
    }
    // Local clock-slot state
    isConsumer(clockId) {
      return this._api.btIsConsumer(BigInt(clockId)) === 1;
    }
    isProducer(clockId) {
      return this._api.btIsProducer(BigInt(clockId)) === 1;
    }
    start(clockId) {
      this._api.btStart(BigInt(clockId));
    }
    stop(clockId) {
      this._api.btStop(BigInt(clockId));
    }
    triggerQueryReply(clockId) {
      this._api.btTriggerQueryReply(BigInt(clockId));
    }
    triggerSyncDelay(clockId) {
      this._api.btTriggerSyncDelay(BigInt(clockId));
    }
    // Reports + commands — take (clockId, payload) pairs; node ID is implicit.
    sendReportTime(clockId, hour, minute) {
      _throwIfError(this._api.btReportTime(this._node.id, BigInt(clockId), hour | 0, minute | 0), "broadcastTime.sendReportTime");
    }
    sendReportDate(clockId, month, day) {
      _throwIfError(this._api.btReportDate(this._node.id, BigInt(clockId), month | 0, day | 0), "broadcastTime.sendReportDate");
    }
    sendReportYear(clockId, year) {
      _throwIfError(this._api.btReportYear(this._node.id, BigInt(clockId), year | 0), "broadcastTime.sendReportYear");
    }
    sendReportRate(clockId, rate) {
      _throwIfError(this._api.btReportRate(this._node.id, BigInt(clockId), rate | 0), "broadcastTime.sendReportRate");
    }
    sendStart(clockId) {
      _throwIfError(this._api.btSendStart(this._node.id, BigInt(clockId)), "broadcastTime.sendStart");
    }
    sendStop(clockId) {
      _throwIfError(this._api.btSendStop(this._node.id, BigInt(clockId)), "broadcastTime.sendStop");
    }
    sendDateRollover(clockId) {
      _throwIfError(this._api.btSendDateRollover(this._node.id, BigInt(clockId)), "broadcastTime.sendDateRollover");
    }
    sendQuery(clockId) {
      _throwIfError(this._api.btSendQuery(this._node.id, BigInt(clockId)), "broadcastTime.sendQuery");
    }
    sendQueryReply(clockId) {
      _throwIfError(this._api.btSendQueryReply(this._node.id, BigInt(clockId)), "broadcastTime.sendQueryReply");
    }
    sendSetTime(clockId, hour, minute) {
      _throwIfError(this._api.btSetTime(this._node.id, BigInt(clockId), hour | 0, minute | 0), "broadcastTime.sendSetTime");
    }
    sendSetDate(clockId, month, day) {
      _throwIfError(this._api.btSetDate(this._node.id, BigInt(clockId), month | 0, day | 0), "broadcastTime.sendSetDate");
    }
    sendSetYear(clockId, year) {
      _throwIfError(this._api.btSetYear(this._node.id, BigInt(clockId), year | 0), "broadcastTime.sendSetYear");
    }
    sendSetRate(clockId, rate) {
      _throwIfError(this._api.btSetRate(this._node.id, BigInt(clockId), rate | 0), "broadcastTime.sendSetRate");
    }
    sendCommandStart(clockId) {
      _throwIfError(this._api.btCommandStart(this._node.id, BigInt(clockId)), "broadcastTime.sendCommandStart");
    }
    sendCommandStop(clockId) {
      _throwIfError(this._api.btCommandStop(this._node.id, BigInt(clockId)), "broadcastTime.sendCommandStop");
    }
  };
  function _throwIfError(rc, ctx) {
    const err = errorForReturnCode(rc, ctx);
    if (err) throw err;
  }
  var OpenLcbNode = class {
    /**
     * @param {bigint} id       48-bit OpenLCB node ID
     * @param {object} params   user-supplied (raw) parameters
     * @param {object} callbacks  user-supplied callback bag
     * @param {object} api      cwrap bundle from wasm-api.js (set after WASM loads)
     * @internal
     */
    constructor(id, params, callbacks) {
      this.id = id;
      this.parameters = resolveParameters(params);
      this._callbacks = callbacks ?? {};
      this._api = null;
      this.train = new TrainFacade(this, null);
      this.broadcastTime = new BroadcastTimeFacade(this, null);
      this._loginResolve = null;
      this.loginComplete = new Promise((resolve) => {
        this._loginResolve = resolve;
      });
    }
    /** @internal — called by the runtime once the cwrap API is ready. */
    _bindApi(api) {
      this._api = api;
      this.train._api = api;
      this.broadcastTime._api = api;
    }
    /** @internal — called by the runtime from the onLoginComplete hook. */
    _resolveLoginComplete() {
      if (this._loginResolve) {
        this._loginResolve(this);
        this._loginResolve = null;
      }
    }
    /** @internal — called by runtime.reboot() before re-materializing on
     *  the fresh WASM module.  Replaces loginComplete so callers can
     *  `await` the post-reboot login. */
    _resetForReboot() {
      this._api = null;
      this._loginResolve = null;
      this.loginComplete = new Promise((resolve) => {
        this._loginResolve = resolve;
      });
    }
    // ------------------------------------------------------------------------
    // Event sends
    // ------------------------------------------------------------------------
    sendPcer(eventId) {
      _throwIfError(this._api.sendPcer(this.id, BigInt(eventId)), "node.sendPcer");
    }
    sendEventWithMti(eventId, mti) {
      _throwIfError(this._api.sendEventWithMti(this.id, BigInt(eventId), mti | 0), "node.sendEventWithMti");
    }
    sendTeachEvent(eventId) {
      _throwIfError(this._api.sendTeach(this.id, BigInt(eventId)), "node.sendTeachEvent");
    }
    sendInitializationEvent() {
      _throwIfError(this._api.sendInit(this.id), "node.sendInitializationEvent");
    }
    /**
     * Send Verify Node ID Addressed to a remote alias.  Reply arrives via the
     * runtime-level `onVerifiedNodeId(node, sourceId, sourceAlias)` callback.
     *
     * @param {number} destAlias       12-bit CAN alias of the remote node.
     * @param {bigint} [destNodeId=0n] Optional 48-bit NodeID for verification;
     *                                  pass 0n for unconditional identify.
     */
    sendVerifyNodeIdAddressed(destAlias, destNodeId = 0n) {
      _throwIfError(
        this._api.sendVerifyAddressed(this.id, destAlias | 0, BigInt(destNodeId)),
        "node.sendVerifyNodeIdAddressed"
      );
    }
    /**
     * Send Verify Node ID Global.  Every node on the bus replies; each fires
     * the runtime-level `onVerifiedNodeId(node, sourceId, sourceAlias)`
     * callback once.
     */
    sendVerifyNodeIdGlobal() {
      _throwIfError(
        this._api.sendVerifyGlobal(this.id),
        "node.sendVerifyNodeIdGlobal"
      );
    }
    /**
     * Ask a remote node for its Simple Node Information (manufacturer name,
     * model, hardware/software version, user-assigned name + description, and
     * the two version-id bytes).  The remote node replies with a Simple Node
     * Info Reply that surfaces via the runtime-level
     * `onSimpleNodeInfoReply(sourceId, sourceAlias, fields)` callback.
     *
     * @param {number} destAlias       12-bit CAN alias of the remote node.
     * @param {bigint} [destNodeId=0n] Optional 48-bit NodeID; pass 0n to
     *                                  address purely by alias.
     */
    sendSimpleNodeInfoRequest(destAlias, destNodeId = 0n) {
      _throwIfError(
        this._api.sendSnipRequest(this.id, destAlias | 0, BigInt(destNodeId)),
        "node.sendSimpleNodeInfoRequest"
      );
    }
    // ------------------------------------------------------------------------
    // Consumer / producer registration
    // ------------------------------------------------------------------------
    /**
     * @param {bigint} eventId
     * @param {number} status   EventStatus value (0/1/2/3)
     * @returns {number} list index on success
     */
    registerConsumer(eventId, status = 0) {
      const rc = this._api.regCEvent(this.id, BigInt(eventId), status | 0);
      if (rc < 0) _throwIfError(rc, "node.registerConsumer");
      return rc;
    }
    registerProducer(eventId, status = 0) {
      const rc = this._api.regPEvent(this.id, BigInt(eventId), status | 0);
      if (rc < 0) _throwIfError(rc, "node.registerProducer");
      return rc;
    }
    clearConsumers() {
      _throwIfError(this._api.clearCEvents(this.id), "node.clearConsumers");
    }
    clearProducers() {
      _throwIfError(this._api.clearPEvents(this.id), "node.clearProducers");
    }
    registerConsumerRange(baseEventId, countEnum) {
      const rc = this._api.regCRange(this.id, BigInt(baseEventId), countEnum | 0);
      if (rc < 0) _throwIfError(rc, "node.registerConsumerRange");
      return rc;
    }
    registerProducerRange(baseEventId, countEnum) {
      const rc = this._api.regPRange(this.id, BigInt(baseEventId), countEnum | 0);
      if (rc < 0) _throwIfError(rc, "node.registerProducerRange");
      return rc;
    }
    clearConsumerRanges() {
      _throwIfError(this._api.clearCRanges(this.id), "node.clearConsumerRanges");
    }
    clearProducerRanges() {
      _throwIfError(this._api.clearPRanges(this.id), "node.clearProducerRanges");
    }
    // ------------------------------------------------------------------------
    // Node-scoped queries
    // ------------------------------------------------------------------------
    /** @returns {number | null} producer list index, or null if not assigned. */
    isProducerEventAssigned(eventId) {
      const rc = this._api.isProducerAssigned(this.id, BigInt(eventId));
      return rc < 0 ? null : rc;
    }
    /** @returns {number | null} consumer list index, or null if not assigned. */
    isConsumerEventAssigned(eventId) {
      const rc = this._api.isConsumerAssigned(this.id, BigInt(eventId));
      return rc < 0 ? null : rc;
    }
    isEventInProducerRanges(eventId) {
      return this._api.isEventInProducerRanges(this.id, BigInt(eventId)) === 1;
    }
    isEventInConsumerRanges(eventId) {
      return this._api.isEventInConsumerRanges(this.id, BigInt(eventId)) === 1;
    }
  };

  // src/openlcb/internals/wasm-api.js
  function createHooks(dispatcher) {
    const dispatch = (nid, cbName, ...args) => {
      const node = dispatcher.nodeOf(nid);
      if (!node) return;
      const cb = node._callbacks?.[cbName];
      if (cb) cb(node, ...args);
    };
    const dispatchReturn = (nid, cbName, fallback, ...args) => {
      const node = dispatcher.nodeOf(nid);
      if (!node) return fallback;
      const cb = node._callbacks?.[cbName];
      return cb ? cb(node, ...args) : fallback;
    };
    return {
      // Transport — frames out to JS.
      onGridconnectTx: (frame) => dispatcher.onGridconnectTx(frame),
      // Periodic — runtime-level, not node-scoped.
      on100msTimer: () => dispatcher.on100msTimer(),
      // Event / identification
      onLoginComplete: (nid) => dispatcher.onLoginComplete(nid),
      onPcEventReport: (nid, eid) => dispatch(nid, "onPcEventReport", BigInt(eid)),
      onPcEventReportWithPayload: (nid, eid, cnt, ptr) => dispatch(nid, "onPcEventReportWithPayload", BigInt(eid), cnt, ptr),
      onConsumedEventPcer: (nid, idx, eid) => dispatch(nid, "onConsumedEventPcer", idx, BigInt(eid)),
      onConsumedEventIdentified: (nid, idx, eid, st) => dispatch(nid, "onConsumedEventIdentified", idx, BigInt(eid), st),
      onProducerIdentifiedSet: (nid, eid) => dispatch(nid, "onProducerIdentifiedSet", BigInt(eid)),
      onProducerIdentifiedClear: (nid, eid) => dispatch(nid, "onProducerIdentifiedClear", BigInt(eid)),
      onProducerIdentifiedUnknown: (nid, eid) => dispatch(nid, "onProducerIdentifiedUnknown", BigInt(eid)),
      onProducerIdentifiedReserved: (nid, eid) => dispatch(nid, "onProducerIdentifiedReserved", BigInt(eid)),
      onConsumerIdentifiedSet: (nid, eid) => dispatch(nid, "onConsumerIdentifiedSet", BigInt(eid)),
      onConsumerIdentifiedClear: (nid, eid) => dispatch(nid, "onConsumerIdentifiedClear", BigInt(eid)),
      onConsumerIdentifiedUnknown: (nid, eid) => dispatch(nid, "onConsumerIdentifiedUnknown", BigInt(eid)),
      onConsumerIdentifiedReserved: (nid, eid) => dispatch(nid, "onConsumerIdentifiedReserved", BigInt(eid)),
      onProducerRangeIdentified: (nid, eid) => dispatch(nid, "onProducerRangeIdentified", BigInt(eid)),
      onConsumerRangeIdentified: (nid, eid) => dispatch(nid, "onConsumerRangeIdentified", BigInt(eid)),
      onEventLearn: (nid, eid) => dispatch(nid, "onEventLearn", BigInt(eid)),
      // Error + rejection
      onOptionalInteractionRejected: (nid, src, ec, rejMti) => dispatch(nid, "onOptionalInteractionRejected", BigInt(src), ec, rejMti),
      onTerminateDueToError: (nid, src, ec, rejMti) => dispatch(nid, "onTerminateDueToError", BigInt(src), ec, rejMti),
      // Verified Node ID reply received from a remote node — runtime-level
      // because the receiving "for-which-node" semantics aren't tied to a
      // specific local node's callback bag (any of our nodes might have
      // asked).  Routes through dispatcher.onVerifiedNodeId.
      onVerifiedNodeId: (nid, sourceId, sourceAlias) => dispatcher.onVerifiedNodeId(BigInt(nid), BigInt(sourceId), sourceAlias),
      // Train state (local — our node IS a train)
      onTrainSpeedChanged: (nid, speed) => dispatch(nid, "onTrainSpeedChanged", speed),
      onTrainFunctionChanged: (nid, addr, val) => dispatch(nid, "onTrainFunctionChanged", addr, val),
      onTrainEmergencyEntered: (nid, type) => dispatch(nid, "onTrainEmergencyEntered", type),
      onTrainEmergencyExited: (nid, type) => dispatch(nid, "onTrainEmergencyExited", type),
      onTrainControllerAssigned: (nid, ctrl) => dispatch(nid, "onTrainControllerAssigned", BigInt(ctrl)),
      onTrainControllerReleased: (nid) => dispatch(nid, "onTrainControllerReleased"),
      onTrainListenerChanged: (nid) => dispatch(nid, "onTrainListenerChanged"),
      onTrainHeartbeatTimeout: (nid) => dispatch(nid, "onTrainHeartbeatTimeout"),
      onTrainHeartbeatRequest: (nid, timeoutS) => dispatch(nid, "onTrainHeartbeatRequest", timeoutS),
      onTrainControllerAssignRequest: (nid, cur, req) => dispatchReturn(nid, "onTrainControllerAssignRequest", true, BigInt(cur), BigInt(req)),
      onTrainControllerChangedRequest: (nid, nc) => dispatchReturn(nid, "onTrainControllerChangedRequest", true, BigInt(nc)),
      // Train replies (throttle observes)
      onTrainQuerySpeedsReply: (nid, set, st, cmd, act) => dispatch(nid, "onTrainQuerySpeedsReply", set, st, cmd, act),
      onTrainQueryFunctionReply: (nid, addr, val) => dispatch(nid, "onTrainQueryFunctionReply", addr, val),
      onTrainControllerAssignReply: (nid, res, cur) => dispatch(nid, "onTrainControllerAssignReply", res, BigInt(cur)),
      onTrainControllerQueryReply: (nid, fl, cur) => dispatch(nid, "onTrainControllerQueryReply", fl, BigInt(cur)),
      onTrainControllerChangedNotifyReply: (nid, res) => dispatch(nid, "onTrainControllerChangedNotifyReply", res),
      onTrainReserveReply: (nid, res) => dispatch(nid, "onTrainReserveReply", res),
      onTrainListenerAttachReply: (nid, lid, res) => dispatch(nid, "onTrainListenerAttachReply", BigInt(lid), res),
      onTrainListenerDetachReply: (nid, lid, res) => dispatch(nid, "onTrainListenerDetachReply", BigInt(lid), res),
      onTrainListenerQueryReply: (nid, count, idx, flags, lid) => dispatch(nid, "onTrainListenerQueryReply", count, idx, flags, BigInt(lid)),
      onTrainSearchMatched: (nid, eid) => dispatch(nid, "onTrainSearchMatched", BigInt(eid)),
      // Train-search no-match (allocate-on-search) — runtime-level because
      // no node exists yet; routes to opts.callbacks.onTrainSearchNoMatch.
      // JS returns a BigInt node ID (node already created) or null.
      onTrainSearchNoMatch: (eid) => dispatcher.onTrainSearchNoMatch(BigInt(eid)),
      // Throttle-side: a remote train replied to a search this device
      // sent.  Carries source 48-bit ID + 12-bit alias.  Runtime-level
      // because the C callback isn't scoped to a particular throttle
      // node — replies go to whatever throttle is interested.
      onTrainSearchReply: (sourceId, sourceAlias, eid) => dispatcher.onTrainSearchReply(BigInt(sourceId), sourceAlias, BigInt(eid)),
      // Simple Node Info Protocol reply — fires when a remote node
      // replies to a Simple Node Info Request.  msgPtr is a transient
      // pointer valid only for the duration of this callback; the
      // dispatcher must read all fields synchronously before returning
      // (the runtime turns msgPtr into a fully-resolved JS object before
      // invoking the user-level callback).
      onSnipReply: (sourceId, sourceAlias, msgPtr) => dispatcher.onSnipReply(BigInt(sourceId), sourceAlias, msgPtr >>> 0),
      // Broadcast time
      onBroadcastTimeChanged: (clockId, hour, minute) => dispatcher.onBroadcastTimeChanged(BigInt(clockId), hour, minute),
      onBroadcastTimeReceived: (nid, clockId, a, b) => dispatch(nid, "onBroadcastTimeReceived", BigInt(clockId), a, b),
      onBroadcastDateReceived: (nid, clockId, a, b) => dispatch(nid, "onBroadcastDateReceived", BigInt(clockId), a, b),
      onBroadcastYearReceived: (nid, clockId, v) => dispatch(nid, "onBroadcastYearReceived", BigInt(clockId), v),
      onBroadcastRateReceived: (nid, clockId, v) => dispatch(nid, "onBroadcastRateReceived", BigInt(clockId), v),
      onBroadcastClockStarted: (nid, clockId) => dispatch(nid, "onBroadcastClockStarted", BigInt(clockId)),
      onBroadcastClockStopped: (nid, clockId) => dispatch(nid, "onBroadcastClockStopped", BigInt(clockId)),
      onBroadcastDateRollover: (nid, clockId) => dispatch(nid, "onBroadcastDateRollover", BigInt(clockId)),
      // Streams (observe-only)
      onStreamInitiateRequest: (statePtr) => dispatcher.onStreamInitiateRequest(statePtr),
      onStreamInitiateReply: (statePtr) => dispatcher.onStreamInitiateReply(statePtr),
      onStreamDataReceived: (statePtr) => dispatcher.onStreamDataReceived(statePtr),
      onStreamDataProceed: (statePtr) => dispatcher.onStreamDataProceed(statePtr),
      onStreamComplete: (statePtr) => dispatcher.onStreamComplete(statePtr),
      // Config memory — runtime delegates to per-node callback
      onConfigMemRead: (nid, addr, count, ptr) => dispatcher.onConfigMemRead(nid, addr, count, ptr),
      onConfigMemWrite: (nid, addr, count, ptr) => dispatcher.onConfigMemWrite(nid, addr, count, ptr),
      // Memory-config operations — notification-only; library has already
      // sent the datagram-OK reply by the time these fire.  The application
      // owns the action (clear storage, soft-reboot, refresh from disk).
      onReboot: (nid) => dispatch(nid, "onReboot"),
      onFactoryReset: (nid) => dispatch(nid, "onFactoryReset"),
      onUpdateComplete: (nid) => dispatch(nid, "onUpdateComplete")
    };
  }
  function createApi(Module) {
    const c = (name, ret, args) => Module.cwrap(name, ret, args);
    return {
      // Lifecycle
      initialize: c("wasm_initialize", null, []),
      run: c("wasm_run", null, []),
      tick: c("wasm_100ms_tick", null, []),
      rx: c("wasm_rx_gridconnect", null, ["string"]),
      // Node builder
      builderReset: c("wasm_node_builder_reset", null, []),
      setSnip: c("wasm_node_set_snip", null, ["number", "string", "string", "string", "string", "number"]),
      setProtocolSupport: c("wasm_node_set_protocol_support", null, ["number", "number"]),
      setEventAutocreate: c("wasm_node_set_event_autocreate", null, ["number", "number"]),
      setConfigurationOptions: c("wasm_node_set_configuration_options", null, ["number", "number", "number", "string"]),
      setAddressSpace: c("wasm_node_set_address_space", "number", ["number", "number", "number", "number", "string"]),
      setCdi: c("wasm_node_set_cdi", "number", ["number", "number"]),
      setFdi: c("wasm_node_set_fdi", "number", ["number", "number"]),
      createNode: c("wasm_create_node", "number", ["bigint"]),
      // Events (generic)
      sendPcer: c("wasm_send_event_pc_report", "number", ["bigint", "bigint"]),
      sendEventWithMti: c("wasm_send_event_with_mti", "number", ["bigint", "bigint", "number"]),
      sendTeach: c("wasm_send_teach_event", "number", ["bigint", "bigint"]),
      sendInit: c("wasm_send_initialization_event", "number", ["bigint"]),
      sendVerifyAddressed: c("wasm_send_verify_node_id_addressed", "number", ["bigint", "number", "bigint"]),
      sendVerifyGlobal: c("wasm_send_verify_node_id_global", "number", ["bigint"]),
      // Simple Node Info Protocol — outbound request and reply-payload
      // extractors.  The extractors take a transient msgPtr supplied by
      // the onSnipReply hook; runtime.js wraps them so the user code
      // never touches the raw pointer.
      sendSnipRequest: c("wasm_send_simple_node_info_request", "number", ["bigint", "number", "bigint"]),
      snipExtractMfgVer: c("wasm_snip_extract_manufacturer_version_id", "number", ["number"]),
      snipExtractUserVer: c("wasm_snip_extract_user_version_id", "number", ["number"]),
      snipExtractName: c("wasm_snip_extract_name", "number", ["number", "number", "number"]),
      snipExtractModel: c("wasm_snip_extract_model", "number", ["number", "number", "number"]),
      snipExtractHwVer: c("wasm_snip_extract_hardware_version", "number", ["number", "number", "number"]),
      snipExtractSwVer: c("wasm_snip_extract_software_version", "number", ["number", "number", "number"]),
      snipExtractUserName: c("wasm_snip_extract_user_name", "number", ["number", "number", "number"]),
      snipExtractUserDesc: c("wasm_snip_extract_user_description", "number", ["number", "number", "number"]),
      regCEvent: c("wasm_register_consumer_eventid", "number", ["bigint", "bigint", "number"]),
      regPEvent: c("wasm_register_producer_eventid", "number", ["bigint", "bigint", "number"]),
      clearCEvents: c("wasm_clear_consumer_eventids", "number", ["bigint"]),
      clearPEvents: c("wasm_clear_producer_eventids", "number", ["bigint"]),
      regCRange: c("wasm_register_consumer_range", "number", ["bigint", "bigint", "number"]),
      regPRange: c("wasm_register_producer_range", "number", ["bigint", "bigint", "number"]),
      clearCRanges: c("wasm_clear_consumer_ranges", "number", ["bigint"]),
      clearPRanges: c("wasm_clear_producer_ranges", "number", ["bigint"]),
      // Node-scoped queries
      isProducerAssigned: c("wasm_util_is_producer_event_assigned", "number", ["bigint", "bigint"]),
      isConsumerAssigned: c("wasm_util_is_consumer_event_assigned", "number", ["bigint", "bigint"]),
      isEventInProducerRanges: c("wasm_util_is_event_in_producer_ranges", "number", ["bigint", "bigint"]),
      isEventInConsumerRanges: c("wasm_util_is_event_in_consumer_ranges", "number", ["bigint", "bigint"]),
      generateEventRangeId: c("wasm_util_generate_event_range_id", "bigint", ["bigint", "number"]),
      aliasForNodeId: c("wasm_util_alias_for_node_id", "number", ["bigint"]),
      // Train — throttle commands (send to remote train)
      tAssign: c("wasm_train_send_assign_controller", "number", ["bigint", "number", "bigint"]),
      tRelease: c("wasm_train_send_release_controller", "number", ["bigint", "number", "bigint"]),
      tEstop: c("wasm_train_send_emergency_stop", "number", ["bigint", "number", "bigint"]),
      tQSpeeds: c("wasm_train_send_query_speeds", "number", ["bigint", "number", "bigint"]),
      tNoop: c("wasm_train_send_noop", "number", ["bigint", "number", "bigint"]),
      tSetSpeed: c("wasm_train_send_set_speed", "number", ["bigint", "number", "bigint", "number"]),
      tSetFunction: c("wasm_train_send_set_function", "number", ["bigint", "number", "bigint", "number", "number"]),
      tQueryFunction: c("wasm_train_send_query_function", "number", ["bigint", "number", "bigint", "number"]),
      // Train — per-node properties
      tSetup: c("wasm_train_setup", "number", ["bigint"]),
      tSetDcc: c("wasm_train_set_dcc_address", "number", ["bigint", "number", "number"]),
      tGetDcc: c("wasm_train_get_dcc_address", "number", ["bigint"]),
      tIsLong: c("wasm_train_is_long_address", "number", ["bigint"]),
      tSetSteps: c("wasm_train_set_speed_steps", "number", ["bigint", "number"]),
      tGetSteps: c("wasm_train_get_speed_steps", "number", ["bigint"]),
      tSetHeartbeat: c("wasm_train_set_heartbeat_timeout", "number", ["bigint", "number"]),
      tGetHeartbeat: c("wasm_train_get_heartbeat_timeout", "number", ["bigint"]),
      // Train — additional throttle senders (added in CLib bindings.c)
      tQueryController: c("wasm_train_send_query_controller", "number", ["bigint", "number", "bigint"]),
      tReserve: c("wasm_train_send_reserve", "number", ["bigint", "number", "bigint"]),
      tReleaseReserve: c("wasm_train_send_release_reserve", "number", ["bigint", "number", "bigint"]),
      tControllerChangingNotify: c("wasm_train_send_controller_changing_notify", "number", ["bigint", "number", "bigint", "bigint"]),
      tListenerAttach: c("wasm_train_send_listener_attach", "number", ["bigint", "number", "bigint", "bigint", "number"]),
      tListenerDetach: c("wasm_train_send_listener_detach", "number", ["bigint", "number", "bigint", "bigint"]),
      tListenerQuery: c("wasm_train_send_listener_query", "number", ["bigint", "number", "bigint", "number"]),
      tSendSearchMatch: c("wasm_train_send_search_match", "number", ["bigint", "bigint"]),
      // Train — read-only state introspection (added for Tranche 1b/1c)
      tGetReserved: c("wasm_train_get_reserved_by_node_id", "bigint", ["bigint"]),
      tGetListenerCount: c("wasm_train_get_listener_count", "number", ["bigint"]),
      tGetListenerAt: c("wasm_train_get_listener_at", "number", ["bigint", "number", "number"]),
      // Broadcast time — lifecycle + send
      btIsConsumer: c("wasm_bt_is_consumer", "number", ["bigint"]),
      btIsProducer: c("wasm_bt_is_producer", "number", ["bigint"]),
      btSetupConsumer: c("wasm_bt_setup_consumer", "number", ["bigint", "bigint"]),
      btSetupProducer: c("wasm_bt_setup_producer", "number", ["bigint", "bigint"]),
      btStart: c("wasm_bt_start", null, ["bigint"]),
      btStop: c("wasm_bt_stop", null, ["bigint"]),
      btTriggerQueryReply: c("wasm_bt_trigger_query_reply", null, ["bigint"]),
      btTriggerSyncDelay: c("wasm_bt_trigger_sync_delay", null, ["bigint"]),
      btReportTime: c("wasm_bt_send_report_time", "number", ["bigint", "bigint", "number", "number"]),
      btReportDate: c("wasm_bt_send_report_date", "number", ["bigint", "bigint", "number", "number"]),
      btReportYear: c("wasm_bt_send_report_year", "number", ["bigint", "bigint", "number"]),
      btReportRate: c("wasm_bt_send_report_rate", "number", ["bigint", "bigint", "number"]),
      btSendStart: c("wasm_bt_send_start", "number", ["bigint", "bigint"]),
      btSendStop: c("wasm_bt_send_stop", "number", ["bigint", "bigint"]),
      btSendDateRollover: c("wasm_bt_send_date_rollover", "number", ["bigint", "bigint"]),
      btSendQuery: c("wasm_bt_send_query", "number", ["bigint", "bigint"]),
      btSendQueryReply: c("wasm_bt_send_query_reply", "number", ["bigint", "bigint"]),
      btSetTime: c("wasm_bt_send_set_time", "number", ["bigint", "bigint", "number", "number"]),
      btSetDate: c("wasm_bt_send_set_date", "number", ["bigint", "bigint", "number", "number"]),
      btSetYear: c("wasm_bt_send_set_year", "number", ["bigint", "bigint", "number"]),
      btSetRate: c("wasm_bt_send_set_rate", "number", ["bigint", "bigint", "number"]),
      btCommandStart: c("wasm_bt_send_command_start", "number", ["bigint", "bigint"]),
      btCommandStop: c("wasm_bt_send_command_stop", "number", ["bigint", "bigint"]),
      // Broadcast-time codecs (pure)
      btMakeClockId: c("wasm_bt_make_clock_id", "bigint", ["bigint"]),
      btIsTimeEvent: c("wasm_bt_is_time_event", "number", ["bigint"]),
      btExtractClockId: c("wasm_bt_extract_clock_id", "bigint", ["bigint"]),
      btGetEventType: c("wasm_bt_get_event_type", "number", ["bigint"]),
      btExtractTime: c("wasm_bt_extract_time", "number", ["bigint"]),
      btExtractDate: c("wasm_bt_extract_date", "number", ["bigint"]),
      btExtractYear: c("wasm_bt_extract_year", "number", ["bigint"]),
      btExtractRate: c("wasm_bt_extract_rate", "number", ["bigint", "number"]),
      btCreateTimeEvent: c("wasm_bt_create_time_event_id", "bigint", ["bigint", "number", "number", "number"]),
      btCreateDateEvent: c("wasm_bt_create_date_event_id", "bigint", ["bigint", "number", "number", "number"]),
      btCreateYearEvent: c("wasm_bt_create_year_event_id", "bigint", ["bigint", "number", "number"]),
      btCreateRateEvent: c("wasm_bt_create_rate_event_id", "bigint", ["bigint", "number", "number"]),
      btCreateCommandEvent: c("wasm_bt_create_command_event_id", "bigint", ["bigint", "number"]),
      // DCC detector (pure)
      dccEncode: c("wasm_dcc_encode_event_id", "bigint", ["bigint", "number", "number"]),
      dccShort: c("wasm_dcc_make_short_address", "number", ["number"]),
      dccConsist: c("wasm_dcc_make_consist_address", "number", ["number"]),
      dccExtractDir: c("wasm_dcc_extract_direction", "number", ["bigint"]),
      dccExtractType: c("wasm_dcc_extract_address_type", "number", ["bigint"]),
      dccExtractRaw: c("wasm_dcc_extract_raw_address", "number", ["bigint"]),
      dccExtractAddr: c("wasm_dcc_extract_dcc_address", "number", ["bigint"]),
      dccExtractDetector: c("wasm_dcc_extract_detector_id", "bigint", ["bigint"]),
      dccIsEmpty: c("wasm_dcc_is_track_empty", "number", ["bigint"]),
      // Train search (pure)
      tsIsSearchEvent: c("wasm_train_search_is_search_event", "number", ["bigint"]),
      tsExtractFlags: c("wasm_train_search_extract_flags", "number", ["bigint"]),
      tsExtractDigits: c("wasm_train_search_extract_digits", null, ["bigint", "number"]),
      tsDigitsToAddress: c("wasm_train_search_digits_to_address", "number", ["number"]),
      tsCreateEventId: c("wasm_train_search_create_event_id", "bigint", ["number", "number"]),
      // Float16 (pure)
      f16FromFloat: c("wasm_float16_from_float", "number", ["number"]),
      f16ToFloat: c("wasm_float16_to_float", "number", ["number"]),
      f16Negate: c("wasm_float16_negate", "number", ["number"]),
      f16IsNaN: c("wasm_float16_is_nan", "number", ["number"]),
      f16IsZero: c("wasm_float16_is_zero", "number", ["number"]),
      f16SpeedWithDirection: c("wasm_float16_speed_with_direction", "number", ["number", "number"]),
      f16GetSpeed: c("wasm_float16_get_speed", "number", ["number"]),
      f16GetDirection: c("wasm_float16_get_direction", "number", ["number"]),
      // Raw memory access (heap views)
      malloc: (n) => Module._malloc(n),
      free: (p) => Module._free(p),
      HEAPU8: Module.HEAPU8,
      HEAP16: Module.HEAP16
    };
  }

  // src/openlcb/runtime.js
  var FRAME_TERMINATOR = "\n";
  function buildCodecNamespaces(api, Module) {
    return {
      float16: Object.freeze({
        fromFloat: (v) => api.f16FromFloat(+v),
        toFloat: (half) => api.f16ToFloat(half | 0),
        negate: (half) => api.f16Negate(half | 0),
        isNaN: (half) => api.f16IsNaN(half | 0) === 1,
        isZero: (half) => api.f16IsZero(half | 0) === 1,
        speedWithDirection: (mps, rev) => api.f16SpeedWithDirection(+mps, rev ? 1 : 0),
        getSpeed: (half) => api.f16GetSpeed(half | 0),
        getDirection: (half) => api.f16GetDirection(half | 0) === 1
      }),
      broadcastTime: Object.freeze({
        makeClockId: (unique48) => api.btMakeClockId(BigInt(unique48)),
        isTimeEvent: (eid) => api.btIsTimeEvent(BigInt(eid)) === 1,
        extractClockId: (eid) => api.btExtractClockId(BigInt(eid)),
        getEventType: (eid) => api.btGetEventType(BigInt(eid)),
        extractTime: (eid) => {
          const r = api.btExtractTime(BigInt(eid));
          return r < 0 ? null : { hour: r >> 8 & 255, minute: r & 255 };
        },
        extractDate: (eid) => {
          const r = api.btExtractDate(BigInt(eid));
          return r < 0 ? null : { month: r >> 8 & 255, day: r & 255 };
        },
        extractYear: (eid) => {
          const r = api.btExtractYear(BigInt(eid));
          return r < 0 ? null : r;
        },
        extractRate: (eid) => {
          const ptr = api.malloc(2);
          try {
            const ok = api.btExtractRate(BigInt(eid), ptr);
            if (ok !== 1) return null;
            return new DataView(Module.HEAPU8.buffer, ptr, 2).getInt16(0, true);
          } finally {
            api.free(ptr);
          }
        },
        createTimeEventId: (clockId, h, m, isSet) => api.btCreateTimeEvent(BigInt(clockId), h | 0, m | 0, isSet ? 1 : 0),
        createDateEventId: (clockId, mo, d, isSet) => api.btCreateDateEvent(BigInt(clockId), mo | 0, d | 0, isSet ? 1 : 0),
        createYearEventId: (clockId, year, isSet) => api.btCreateYearEvent(BigInt(clockId), year | 0, isSet ? 1 : 0),
        createRateEventId: (clockId, rate, isSet) => api.btCreateRateEvent(BigInt(clockId), rate | 0, isSet ? 1 : 0),
        createCommandEventId: (clockId, cmdEnum) => api.btCreateCommandEvent(BigInt(clockId), cmdEnum | 0)
      }),
      dccDetector: Object.freeze({
        encodeEventId: (detectorId, dir, raw14) => api.dccEncode(BigInt(detectorId), dir | 0, raw14 | 0),
        makeShortAddress: (shortAddr) => api.dccShort(shortAddr | 0),
        makeConsistAddress: (consistAddr) => api.dccConsist(consistAddr | 0),
        extractDirection: (eid) => api.dccExtractDir(BigInt(eid)),
        extractAddressType: (eid) => api.dccExtractType(BigInt(eid)),
        extractRawAddress: (eid) => api.dccExtractRaw(BigInt(eid)),
        extractDccAddress: (eid) => api.dccExtractAddr(BigInt(eid)),
        extractDetectorId: (eid) => api.dccExtractDetector(BigInt(eid)),
        isTrackEmpty: (eid) => api.dccIsEmpty(BigInt(eid)) === 1
      }),
      trainSearch: Object.freeze({
        isSearchEvent: (eid) => api.tsIsSearchEvent(BigInt(eid)) === 1,
        extractFlags: (eid) => api.tsExtractFlags(BigInt(eid)),
        createEventId: (addr, flags) => api.tsCreateEventId(addr >>> 0, flags | 0),
        extractDigits: (eid) => {
          const ptr = api.malloc(6);
          try {
            api.tsExtractDigits(BigInt(eid), ptr);
            return new Uint8Array(Module.HEAPU8.subarray(ptr, ptr + 6));
          } finally {
            api.free(ptr);
          }
        },
        digitsToAddress: (digits) => {
          const ptr = api.malloc(6);
          try {
            Module.HEAPU8.set(digits, ptr);
            return api.tsDigitsToAddress(ptr);
          } finally {
            api.free(ptr);
          }
        }
      }),
      util: Object.freeze({
        generateEventRangeId: (baseId, countEnum) => api.generateEventRangeId(BigInt(baseId), countEnum | 0),
        // CAN alias for a known node ID.  Returns 0 if unknown (no AMD
        // seen yet, or local login incomplete).
        aliasForNodeId: (nodeId) => api.aliasForNodeId(BigInt(nodeId))
      })
    };
  }
  var SNIP_BUF_MAX = 64;
  function _extractSnip(api, Module, msgPtr) {
    const buf = api.malloc(SNIP_BUF_MAX);
    const readString = (extractFn) => {
      if (!buf) return "";
      const written = extractFn(msgPtr, buf, SNIP_BUF_MAX) | 0;
      if (written <= 0) return "";
      const end = Math.min(written, SNIP_BUF_MAX);
      const slice = Module.HEAPU8.subarray(buf, buf + end);
      let nulAt = slice.indexOf(0);
      if (nulAt < 0) nulAt = slice.length;
      return new TextDecoder("utf-8").decode(slice.subarray(0, nulAt));
    };
    const readByte = (extractFn) => {
      const v = extractFn(msgPtr) | 0;
      return v < 0 ? null : v;
    };
    try {
      return {
        manufacturerVersionId: readByte(api.snipExtractMfgVer),
        userVersionId: readByte(api.snipExtractUserVer),
        manufacturerName: readString(api.snipExtractName),
        model: readString(api.snipExtractModel),
        hardwareVersion: readString(api.snipExtractHwVer),
        softwareVersion: readString(api.snipExtractSwVer),
        userName: readString(api.snipExtractUserName),
        userDescription: readString(api.snipExtractUserDesc)
      };
    } finally {
      if (buf) api.free(buf);
    }
  }
  var OpenLcb = class _OpenLcb {
    /** @internal — use OpenLcb.create(). */
    constructor() {
      this._nodes = /* @__PURE__ */ new Map();
      this._pendingNodes = [];
      this._Module = null;
      this._api = null;
      this._transport = null;
      this._callbacks = null;
      this._running = false;
      this._runInterval = null;
      this._tickInterval = null;
      this.float16 = null;
      this.broadcastTime = null;
      this.dccDetector = null;
      this.trainSearch = null;
      this.util = null;
    }
    /**
     * Async factory — loads WASM, wires the transport, installs callback
     * hooks, and runs wasm_initialize().  Returns a fully-initialized
     * runtime; nodes can be created immediately via createNode(), but no
     * transport traffic flows until start() is called.
     *
     * @param {object} opts
     * @param {object} opts.transport   Transport with connect/disconnect/send + onMessage/onError/onStateChange
     * @param {object} [opts.callbacks] Runtime-level callbacks: onTransportConnect/Disconnect/Error, on100msTimer,
     *                                  onBroadcastTimeChanged, onTrainSearchNoMatch, onTrainSearchReply,
     *                                  onVerifiedNodeId, onSimpleNodeInfoReply, onStream*
     * @returns {Promise<OpenLcb>}
     */
    static async create(opts) {
      if (!opts) throw new Error("OpenLcb.create: opts required");
      if (!opts.transport) throw new Error("OpenLcb.create: opts.transport required");
      const self = new _OpenLcb();
      self._transport = opts.transport;
      self._callbacks = opts.callbacks ?? {};
      const dispatcher = {
        nodeOf: (nid) => self._nodes.get(BigInt(nid)) ?? null,
        onGridconnectTx: (frame) => self._onGridconnectTx(frame),
        on100msTimer: () => self._callbacks.on100msTimer?.(),
        onLoginComplete: (nid) => {
          const n = self._nodes.get(BigInt(nid));
          if (!n) return;
          n._resolveLoginComplete();
          n._callbacks.onLoginComplete?.(n);
        },
        onBroadcastTimeChanged: (clockId, h, m) => self._callbacks.onBroadcastTimeChanged?.(clockId, h, m),
        // Train-search no-match with Allocate flag: JS may create a new
        // train node and return its BigInt ID (or null to decline).
        // Routes to opts.callbacks.onTrainSearchNoMatch(searchEventId).
        onTrainSearchNoMatch: (searchEventId) => {
          const cb = self._callbacks.onTrainSearchNoMatch;
          if (!cb) return null;
          const result = cb(searchEventId);
          if (typeof result === "bigint") return result;
          if (result && typeof result.id === "bigint") return result.id;
          return null;
        },
        // Throttle-side: a remote train replied to a search this device
        // sent.  Carries source 48-bit ID + 12-bit alias.  Routes to
        // opts.callbacks.onTrainSearchReply(sourceId, sourceAlias, searchEventId).
        onTrainSearchReply: (sourceId, sourceAlias, searchEventId) => {
          self._callbacks.onTrainSearchReply?.(sourceId, sourceAlias, searchEventId);
        },
        // Verified Node ID reply — fires once per remote replier in
        // response to a Verify Node ID we sent (addressed or global).
        // Carries the receiving node + the source's resolved (id, alias).
        onVerifiedNodeId: (receivingNodeId, sourceId, sourceAlias) => {
          const node = self._nodes.get(BigInt(receivingNodeId));
          self._callbacks.onVerifiedNodeId?.(node ?? null, sourceId, sourceAlias);
        },
        // Simple Node Info reply — fires when a remote node answers a
        // request issued via OpenLcbNode#sendSimpleNodeInfoRequest.  The
        // raw msgPtr is only valid during this hook, so we fully extract
        // the payload before invoking the user's callback.  Routes to
        // opts.callbacks.onSimpleNodeInfoReply(sourceId, sourceAlias, fields).
        onSnipReply: (sourceId, sourceAlias, msgPtr) => {
          const cb = self._callbacks.onSimpleNodeInfoReply;
          if (!cb) return;
          cb(sourceId, sourceAlias, _extractSnip(self._api, self._Module, msgPtr));
        },
        onStreamInitiateRequest: (ptr) => self._callbacks.onStreamInitiateRequest?.(ptr) ?? false,
        onStreamInitiateReply: (ptr) => self._callbacks.onStreamInitiateReply?.(ptr),
        onStreamDataReceived: (ptr) => self._callbacks.onStreamDataReceived?.(ptr),
        onStreamDataProceed: (ptr) => self._callbacks.onStreamDataProceed?.(ptr),
        onStreamComplete: (ptr) => self._callbacks.onStreamComplete?.(ptr),
        onConfigMemRead: (nid, addr, count, ptr) => self._onConfigMemRead(nid, addr, count, ptr),
        onConfigMemWrite: (nid, addr, count, ptr) => self._onConfigMemWrite(nid, addr, count, ptr)
      };
      self._dispatcher = dispatcher;
      let Module;
      try {
        Module = await openlcb_core_default(createHooks(dispatcher));
      } catch (e) {
        throw new WasmLoadError("WASM factory failed", { cause: e });
      }
      self._Module = Module;
      self._api = createApi(Module);
      self._api.initialize();
      self._transport.onMessage = (chunk) => self._onTransportData(chunk);
      self._transport.onError = (err) => self._callbacks.onTransportError?.(err);
      self._transport.onStateChange = (state) => {
        if (state === "connected") {
          self._startPump();
          self._callbacks.onTransportConnect?.();
        } else if (state === "disconnected") {
          self._stopPump();
          self._callbacks.onTransportDisconnect?.();
        }
      };
      Object.assign(self, buildCodecNamespaces(self._api, Module));
      for (const { id, params, callbacks } of self._pendingNodes) {
        self._materializeNode(id, params, callbacks);
      }
      self._pendingNodes.length = 0;
      return self;
    }
    /**
     * Allocate a new OpenLCB node.  Returns a handle immediately; login
     * runs in the background once the transport is open.
     *
     * @param {bigint | number} nodeId   48-bit OpenLCB node ID
     * @param {object}   parameters      SNIP, protocolSupport, address spaces, ...
     * @param {object}   [callbacks]     Per-node callback bag
     * @returns {OpenLcbNode}
     */
    createNode(nodeId, parameters, callbacks) {
      const id = BigInt(nodeId);
      const node = new OpenLcbNode(id, parameters, callbacks ?? {});
      this._nodes.set(id, node);
      if (this._api) {
        this._materializeNode(id, parameters, callbacks);
        node._bindApi(this._api);
      } else {
        this._pendingNodes.push({ id, params: parameters, callbacks });
      }
      return node;
    }
    _materializeNode(id, params, _callbacks) {
      buildAndCreateNode(this._api, id, params);
      const node = this._nodes.get(id);
      if (node) node._bindApi(this._api);
    }
    /**
     * Open the transport and start pumping the state machine.  Resolves
     * when the transport is connected.  Rejects (TransportConnectError)
     * if the transport fails to open.
     */
    async start() {
      if (this._running) return;
      this._running = true;
      try {
        await Promise.resolve(this._transport.connect());
      } catch (e) {
        this._running = false;
        this._stopPump();
        throw new TransportConnectError("transport.connect() failed", { cause: e });
      }
    }
    /**
     * Close the transport and stop the pump.  Node handles remain valid
     * but dormant until start() is called again.
     */
    async stop() {
      this._running = false;
      this._stopPump();
      await Promise.resolve(this._transport.disconnect());
    }
    /**
     * Soft-reboot the OpenLCB stack: discard the WASM module, instantiate
     * a fresh one, and replay every previously-created node onto it.  The
     * transport is NOT touched — the existing connection (e.g. WebSocket
     * to JMRI) stays open across the reboot.  Node handle objects survive;
     * each one's loginComplete promise is replaced so callers can `await`
     * the post-reboot login.
     *
     * Use this from `onReboot` / `onFactoryReset` callbacks to honor a
     * Memory Configuration Reset/Reboot or Factory Reset datagram with
     * spec-correct "fresh node, same medium" semantics.
     */
    async reboot() {
      if (!this._dispatcher) throw new Error("reboot() before create() resolved");
      this._stopPump();
      const specs = [];
      for (const node of this._nodes.values()) {
        specs.push({ node, params: node.parameters, callbacks: node._callbacks });
      }
      this._Module = null;
      this._api = null;
      let Module;
      try {
        Module = await openlcb_core_default(createHooks(this._dispatcher));
      } catch (e) {
        throw new WasmLoadError("WASM factory failed during reboot", { cause: e });
      }
      this._Module = Module;
      this._api = createApi(Module);
      this._api.initialize();
      Object.assign(this, buildCodecNamespaces(this._api, Module));
      for (const { node, params, callbacks } of specs) {
        node._resetForReboot();
        this._materializeNode(node.id, params, callbacks);
        node._bindApi(this._api);
      }
      this._startPump();
    }
    // ------------------------------------------------------------------------
    // Pump — drains WASM state machine under a time budget per slice.
    // Only runs while the runtime is marked running AND WASM is ready.
    // ------------------------------------------------------------------------
    _startPump() {
      if (!this._running || !this._api || this._runInterval) return;
      const DRAIN_BUDGET_MS = 5;
      const now = typeof performance !== "undefined" && performance.now ? () => performance.now() : () => Date.now();
      this._runInterval = setInterval(() => {
        const deadline = now() + DRAIN_BUDGET_MS;
        do {
          this._api.run();
        } while (now() < deadline);
      }, 5);
      this._tickInterval = setInterval(() => this._api.tick(), 100);
    }
    _stopPump() {
      if (this._runInterval) {
        clearInterval(this._runInterval);
        this._runInterval = null;
      }
      if (this._tickInterval) {
        clearInterval(this._tickInterval);
        this._tickInterval = null;
      }
    }
    // ------------------------------------------------------------------------
    // Transport ⇄ WASM glue
    // ------------------------------------------------------------------------
    _onTransportData(chunk) {
      if (!this._api) return;
      let text;
      if (typeof chunk === "string") text = chunk;
      else if (chunk instanceof ArrayBuffer) text = new TextDecoder().decode(new Uint8Array(chunk));
      else if (chunk instanceof Uint8Array) text = new TextDecoder().decode(chunk);
      else return;
      this._api.rx(text);
    }
    _onGridconnectTx(frame) {
      this._transport.send(frame + FRAME_TERMINATOR);
    }
    // ------------------------------------------------------------------------
    // Config memory dispatch — per-node callbacks in the node's callback bag.
    // ------------------------------------------------------------------------
    _onConfigMemRead(nid, addr, count, heapPtr) {
      const node = this._nodes.get(BigInt(nid));
      if (!node) return 0;
      const fn = node._callbacks.onConfigMemRead;
      if (!fn) return 0;
      const n = Number(count);
      const buf = new Uint8Array(n);
      const written = fn(node, Number(addr), n, buf) | 0;
      if (written > 0) this._Module.HEAPU8.set(buf.subarray(0, written), heapPtr);
      return written;
    }
    _onConfigMemWrite(nid, addr, count, heapPtr) {
      const node = this._nodes.get(BigInt(nid));
      if (!node) return 0;
      const fn = node._callbacks.onConfigMemWrite;
      const n = Number(count);
      const bytes = this._Module.HEAPU8.subarray(heapPtr, heapPtr + n);
      if (!fn) return n;
      return fn(node, Number(addr), n, bytes) | 0;
    }
  };

  // src/drivers/websocket/transport.js
  var DEFAULT_RECONNECT_MIN_MS = 500;
  var DEFAULT_RECONNECT_MAX_MS = 3e4;
  var WS_STATE = Object.freeze({
    DISCONNECTED: "disconnected",
    CONNECTING: "connecting",
    CONNECTED: "connected",
    CLOSING: "closing"
  });
  var WebSocketTransport = class {
    /**
     * @param {object} opts
     * @param {string}   opts.url            WebSocket URL (ws:// or wss://)
     * @param {Function} [opts.WebSocketImpl] override the WebSocket ctor (Node, tests)
     * @param {boolean}  [opts.autoReconnect=true]
     * @param {number}   [opts.reconnectMinMs=500]
     * @param {number}   [opts.reconnectMaxMs=30000]
     */
    constructor(opts) {
      if (!opts?.url) throw new Error("WebSocketTransport: url is required");
      this._url = opts.url;
      this._WebSocketImpl = opts.WebSocketImpl ?? (typeof WebSocket !== "undefined" ? WebSocket : null);
      this._autoReconnect = opts.autoReconnect ?? true;
      this._reconnectMinMs = opts.reconnectMinMs ?? DEFAULT_RECONNECT_MIN_MS;
      this._reconnectMaxMs = opts.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
      this._ws = null;
      this._state = WS_STATE.DISCONNECTED;
      this._reconnectAttempt = 0;
      this._reconnectTimer = null;
      this._manualClose = false;
      this.onMessage = null;
      this.onError = null;
      this.onStateChange = null;
      this._connectResolve = null;
      this._connectReject = null;
      this._disconnectResolve = null;
    }
    get state() {
      return this._state;
    }
    /** Open the socket.  Resolves when connected, rejects on open failure. */
    connect() {
      if (this._state === WS_STATE.CONNECTED) return Promise.resolve();
      if (this._state === WS_STATE.CONNECTING) {
        return new Promise((res, rej) => {
          const prevRes = this._connectResolve, prevRej = this._connectReject;
          this._connectResolve = () => {
            prevRes?.();
            res();
          };
          this._connectReject = (e) => {
            prevRej?.(e);
            rej(e);
          };
        });
      }
      if (!this._WebSocketImpl) {
        return Promise.reject(new TransportConnectError(
          "WebSocketTransport: no WebSocket implementation available (pass opts.WebSocketImpl)"
        ));
      }
      this._manualClose = false;
      return new Promise((resolve, reject) => {
        this._connectResolve = resolve;
        this._connectReject = reject;
        this._openSocket();
      });
    }
    /** Close the socket.  Resolves when closed.  Suppresses auto-reconnect. */
    disconnect(code, reason) {
      this._manualClose = true;
      this._clearReconnect();
      if (this._ws && (this._state === WS_STATE.CONNECTING || this._state === WS_STATE.CONNECTED)) {
        return new Promise((resolve) => {
          this._disconnectResolve = resolve;
          this._setState(WS_STATE.CLOSING);
          try {
            this._ws.close(code, reason);
          } catch (e) {
          }
        });
      }
      this._setState(WS_STATE.DISCONNECTED);
      return Promise.resolve();
    }
    /**
     * Send a payload.  Throws TransportBusyError if not connected.
     * @param {string | ArrayBuffer | Uint8Array} payload
     */
    send(payload) {
      if (this._state !== WS_STATE.CONNECTED || !this._ws) {
        throw new TransportBusyError("WebSocketTransport.send: socket not connected");
      }
      try {
        this._ws.send(payload);
      } catch (e) {
        this._reportError(e);
        throw new TransportBusyError("WebSocketTransport.send: underlying send() failed", { cause: e });
      }
    }
    // ------------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------------
    _setState(newState) {
      if (this._state === newState) return;
      this._state = newState;
      this.onStateChange?.(newState);
    }
    _openSocket() {
      this._setState(WS_STATE.CONNECTING);
      let ws;
      try {
        ws = new this._WebSocketImpl(this._url);
      } catch (e) {
        this._reportError(e);
        this._rejectPendingConnect(new TransportConnectError("WebSocket ctor threw", { cause: e }));
        this._scheduleReconnect();
        return;
      }
      this._ws = ws;
      ws.onopen = () => {
        this._setState(WS_STATE.CONNECTED);
        this._reconnectAttempt = 0;
        this._connectResolve?.();
        this._connectResolve = null;
        this._connectReject = null;
      };
      ws.onmessage = (event) => {
        try {
          this.onMessage?.(event.data);
        } catch (e) {
          this._reportError(e);
        }
      };
      ws.onerror = (err) => this._reportError(err);
      ws.onclose = (event) => {
        const wasConnected = this._state === WS_STATE.CONNECTED;
        this._ws = null;
        this._setState(WS_STATE.DISCONNECTED);
        this._disconnectResolve?.();
        this._disconnectResolve = null;
        if (!wasConnected) {
          this._rejectPendingConnect(new TransportConnectError(
            `socket closed before open (code=${event?.code})`
          ));
        }
        if (!this._manualClose && this._autoReconnect) {
          this._scheduleReconnect();
        }
      };
    }
    _reportError(err) {
      this.onError?.(err);
    }
    _rejectPendingConnect(err) {
      if (this._connectReject) {
        this._connectReject(err);
        this._connectResolve = null;
        this._connectReject = null;
      }
    }
    _scheduleReconnect() {
      if (!this._autoReconnect || this._manualClose) return;
      if (this._reconnectTimer) return;
      const backoff = Math.min(
        this._reconnectMaxMs,
        this._reconnectMinMs * Math.pow(2, this._reconnectAttempt)
      );
      this._reconnectAttempt++;
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        if (this._state === WS_STATE.DISCONNECTED && !this._manualClose) {
          this._openSocket();
        }
      }, backoff);
    }
    _clearReconnect() {
      if (this._reconnectTimer) {
        clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
      }
      this._reconnectAttempt = 0;
    }
  };

  // src/storage/local-store.js
  var LocalStore = class {
    /**
     * @param {Object} [opts]
     * @param {string} [opts.keyPrefix='openlcb:']
     * @param {Storage} [opts.storage]  override for testing (default: window.localStorage)
     */
    constructor(opts = {}) {
      this._prefix = opts.keyPrefix ?? "openlcb:";
      this._storage = opts.storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
      if (!this._storage) {
        throw new Error("LocalStore: no localStorage available (pass opts.storage)");
      }
    }
    /** Returns the stored bytes, or null if the key is unset. */
    getBytes(nodeId, key) {
      const encoded = this._storage.getItem(this._fullKey(nodeId, key));
      if (encoded == null) return null;
      const raw = atob(encoded);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      return out;
    }
    setBytes(nodeId, key, bytes) {
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      this._storage.setItem(this._fullKey(nodeId, key), btoa(s));
    }
    /** Returns the parsed JSON value, or null if the key is unset. */
    getJson(nodeId, key) {
      const s = this._storage.getItem(this._fullKey(nodeId, key));
      return s == null ? null : JSON.parse(s);
    }
    setJson(nodeId, key, value) {
      this._storage.setItem(this._fullKey(nodeId, key), JSON.stringify(value));
    }
    remove(nodeId, key) {
      this._storage.removeItem(this._fullKey(nodeId, key));
    }
    /** Wipes every key stored under this node ID. */
    clearNode(nodeId) {
      const prefix = this._nodePrefix(nodeId);
      const toRemove = [];
      for (let i = 0; i < this._storage.length; i++) {
        const k = this._storage.key(i);
        if (k != null && k.startsWith(prefix)) toRemove.push(k);
      }
      for (const k of toRemove) this._storage.removeItem(k);
    }
    _nodePrefix(nodeId) {
      return this._prefix + BigInt(nodeId).toString(16).padStart(12, "0") + ":";
    }
    _fullKey(nodeId, key) {
      return this._nodePrefix(nodeId) + key;
    }
  };

  // src/storage/localstorage-config-memory.js
  var DEFAULT_KEY = "config-mem";
  var LocalStorageConfigMemory = class {
    /**
     * @param {Object} [opts]
     * @param {number} [opts.size=1024]      capacity (bytes) — should match
     *                                       node's addressSpaceConfigMemory.highestAddress
     * @param {LocalStore} [opts.store]      backing KV (default: new LocalStore())
     * @param {string} [opts.keyPrefix]      forwarded to LocalStore if `store` is omitted
     * @param {Storage} [opts.storage]       forwarded to LocalStore if `store` is omitted
     * @param {string} [opts.subKey]         per-node sub-key (default: 'config-mem')
     */
    constructor(opts = {}) {
      this._size = opts.size ?? 1024;
      this._subKey = opts.subKey ?? DEFAULT_KEY;
      this._store = opts.store ?? new LocalStore({
        keyPrefix: opts.keyPrefix,
        storage: opts.storage
      });
    }
    /** Matches the `onConfigMemRead` callback signature. */
    read(node, address, count, buffer) {
      const bytes = this._loadOrInit(node.id);
      for (let i = 0; i < count; i++) {
        buffer[i] = bytes[address + i] ?? 0;
      }
      return count;
    }
    /** Matches the `onConfigMemWrite` callback signature. */
    write(node, address, count, buffer) {
      const bytes = this._loadOrInit(node.id);
      const need = address + count;
      const target = need > bytes.length ? this._growTo(bytes, need) : bytes;
      for (let i = 0; i < count; i++) {
        target[address + i] = buffer[i];
      }
      this._store.setBytes(node.id, this._subKey, target);
      return count;
    }
    /** Erase the stored config-memory blob for `nodeId`. */
    clear(nodeId) {
      this._store.remove(nodeId, this._subKey);
    }
    _loadOrInit(nodeId) {
      return this._store.getBytes(nodeId, this._subKey) ?? new Uint8Array(this._size);
    }
    _growTo(bytes, size) {
      const grown = new Uint8Array(size);
      grown.set(bytes);
      return grown;
    }
  };
  return __toCommonJS(index_exports);
})();
