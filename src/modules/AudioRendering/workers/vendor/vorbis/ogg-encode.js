// Modified 2026-10-29: paired Emscripten factory/current heap views; idempotent native encoder cleanup.
import createVorbisModule from "./vorbis.wasm.js";
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// meta.js
var meta_exports = {};
__export(meta_exports, {
  metaStream: () => metaStream,
  writeMeta: () => writeMeta
});
function concat(arrays) {
  let n = 0;
  for (let a of arrays) n += a.length;
  let out = new Uint8Array(n), off = 0;
  for (let a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
function buildCommentPacket(meta) {
  let vendor = TE.encode("audio-encode");
  let entries = [];
  for (let k in VORBIS_MAP) {
    let v = meta[k];
    if (v == null || v === "") continue;
    entries.push(TE.encode(VORBIS_MAP[k] + "=" + v));
  }
  let size = 7 + 4 + vendor.length + 4;
  for (let e of entries) size += 4 + e.length;
  size += 1;
  let b = new Uint8Array(size);
  let d = new DataView(b.buffer);
  b[0] = 3;
  b.set(TE.encode("vorbis"), 1);
  let pos = 7;
  d.setUint32(pos, vendor.length, true);
  pos += 4;
  b.set(vendor, pos);
  pos += vendor.length;
  d.setUint32(pos, entries.length, true);
  pos += 4;
  for (let e of entries) {
    d.setUint32(pos, e.length, true);
    pos += 4;
    b.set(e, pos);
    pos += e.length;
  }
  b[pos] = 1;
  return b;
}
function parsePages(bytes) {
  let pages = [];
  let off = 0;
  while (off + 27 <= bytes.length) {
    if (!(bytes[off] === 79 && bytes[off + 1] === 103 && bytes[off + 2] === 103 && bytes[off + 3] === 83)) break;
    let nSegs = bytes[off + 26];
    let segTable = bytes.subarray(off + 27, off + 27 + nSegs);
    let payloadLen = 0;
    for (let i = 0; i < nSegs; i++) payloadLen += segTable[i];
    let payloadStart = off + 27 + nSegs;
    pages.push({ start: off, len: 27 + nSegs + payloadLen, nSegs, segTable, payloadStart });
    off += 27 + nSegs + payloadLen;
  }
  return pages;
}
function buildPage(payload, segLens, serial, seq, granule, flags) {
  let nSegs = segLens.length;
  let page = new Uint8Array(27 + nSegs + payload.length);
  let d = new DataView(page.buffer);
  page[0] = 79;
  page[1] = 103;
  page[2] = 103;
  page[3] = 83;
  page[4] = 0;
  page[5] = flags;
  d.setUint32(6, Number(granule & 0xFFFFFFFFn), true);
  d.setUint32(10, Number(granule >> 32n & 0xFFFFFFFFn), true);
  d.setUint32(14, serial, true);
  d.setUint32(18, seq, true);
  d.setUint32(22, 0, true);
  page[26] = nSegs;
  for (let i = 0; i < nSegs; i++) page[27 + i] = segLens[i];
  page.set(payload, 27 + nSegs);
  d.setUint32(22, oggCrc(page), true);
  return page;
}
function pageify(packets, serial, startSeq, firstFlags) {
  let allBytes = concat(packets);
  let segLens = [];
  for (let p of packets) {
    let n = Math.floor(p.length / 255);
    for (let i = 0; i < n; i++) segLens.push(255);
    segLens.push(p.length % 255);
  }
  let pages = [], segIdx = 0, byteOff = 0, seq = startSeq, pageNo = 0, prevLast = -1;
  while (segIdx < segLens.length) {
    let count = Math.min(255, segLens.length - segIdx);
    let pageSegs = segLens.slice(segIdx, segIdx + count);
    let payloadLen = pageSegs.reduce((a, b) => a + b, 0);
    let flags = pageNo === 0 ? firstFlags : prevLast === 255 ? 1 : 0;
    pages.push(buildPage(allBytes.subarray(byteOff, byteOff + payloadLen), pageSegs, serial, seq++, 0n, flags));
    prevLast = pageSegs[pageSegs.length - 1];
    segIdx += count;
    byteOff += payloadLen;
    pageNo++;
  }
  return { pages, nextSeq: seq };
}
function writeMeta(bytes, { meta = {} } = {}) {
  let pages = parsePages(bytes);
  if (pages.length < 2) return bytes;
  let serial = new DataView(bytes.buffer, bytes.byteOffset).getUint32(pages[0].start + 14, true);
  let packets = [], cur = [], lastHeaderPage = -1, bailed = false;
  for (let pi = 0; pi < pages.length && packets.length < 3; pi++) {
    let pg = pages[pi], segOff = pg.payloadStart;
    for (let s2 = 0; s2 < pg.nSegs; s2++) {
      let segLen = pg.segTable[s2];
      cur.push(bytes.subarray(segOff, segOff + segLen));
      segOff += segLen;
      if (segLen < 255) {
        packets.push(concat(cur));
        cur = [];
        if (packets.length === 3) {
          if (s2 < pg.nSegs - 1) bailed = true;
          lastHeaderPage = pi;
          break;
        }
      }
    }
  }
  if (bailed || packets.length < 3) return bytes;
  let c = packets[1];
  if (!(c[0] === 3 && c[1] === 118 && c[2] === 111 && c[3] === 114 && c[4] === 98 && c[5] === 105 && c[6] === 115)) return bytes;
  let header = [packets[0], buildCommentPacket(meta), packets[2]];
  let p0 = pageify([header[0]], serial, 0, 2);
  let p1 = pageify([header[1], header[2]], serial, p0.nextSeq, 0);
  let seq = p1.nextSeq;
  let audio = [];
  for (let pi = lastHeaderPage + 1; pi < pages.length; pi++) {
    let pg = pages[pi];
    let copy = bytes.slice(pg.start, pg.start + pg.len);
    let d = new DataView(copy.buffer);
    d.setUint32(18, seq++, true);
    d.setUint32(22, 0, true);
    d.setUint32(22, oggCrc(copy), true);
    audio.push(copy);
  }
  return concat([...p0.pages, ...p1.pages, ...audio]);
}
function metaStream(meta = {}) {
  let held = new Uint8Array(0), delta = null;
  return (bytes) => {
    held = held.length ? concat([held, bytes]) : bytes;
    let out = [];
    if (delta == null) {
      let pages = parsePages(held).filter((pg) => pg.start + pg.len <= held.length), packets = 0, end = -1;
      for (let pg of pages) {
        for (let s2 = 0; s2 < pg.nSegs && packets < 3; s2++) if (pg.segTable[s2] < 255) packets++;
        if (packets === 3) {
          end = pg.start + pg.len;
          break;
        }
      }
      if (end < 0) return new Uint8Array(0);
      let before = pages.findIndex((pg) => pg.start + pg.len === end) + 1;
      let header = writeMeta(held.subarray(0, end), { meta });
      delta = parsePages(header).length - before;
      out.push(header);
      held = held.subarray(end);
    }
    if (!delta) {
      out.push(held);
      held = new Uint8Array(0);
      return concat(out);
    }
    let used = 0;
    for (let pg of parsePages(held)) {
      if (pg.start + pg.len > held.length) break;
      let copy = held.slice(pg.start, pg.start + pg.len), d = new DataView(copy.buffer);
      d.setUint32(18, d.getUint32(18, true) + delta, true);
      d.setUint32(22, 0, true);
      d.setUint32(22, oggCrc(copy), true);
      out.push(copy);
      used = pg.start + pg.len;
    }
    held = held.subarray(used);
    return concat(out);
  };
}
function oggCrc(data) {
  if (!crcTbl) {
    crcTbl = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let r = i << 24;
      for (let j = 0; j < 8; j++) r = (r & 2147483648 ? r << 1 ^ 79764919 : r << 1) >>> 0;
      crcTbl[i] = r >>> 0;
    }
  }
  let crc = 0;
  for (let i = 0; i < data.length; i++) crc = (crc << 8 ^ crcTbl[(crc >>> 24 ^ data[i]) & 255]) >>> 0;
  return crc >>> 0;
}
var TE, VORBIS_MAP, crcTbl;
var init_meta = __esm({
  "meta.js"() {
    TE = new TextEncoder();
    VORBIS_MAP = {
      title: "TITLE",
      artist: "ARTIST",
      album: "ALBUM",
      albumartist: "ALBUMARTIST",
      composer: "COMPOSER",
      genre: "GENRE",
      year: "DATE",
      track: "TRACKNUMBER",
      disc: "DISCNUMBER",
      bpm: "BPM",
      key: "KEY",
      comment: "COMMENT",
      copyright: "COPYRIGHT",
      isrc: "ISRC",
      publisher: "PUBLISHER",
      software: "ENCODER",
      lyrics: "LYRICS"
    };
  }
});

// ../../node_modules/@swc/helpers/esm/_define_property.js
function _define_property(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
  } else obj[key] = value;
  return obj;
}

// ../../node_modules/@swc/helpers/esm/_object_spread.js
function _object_spread(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};
    var ownKeys2 = Object.keys(source);
    if (typeof Object.getOwnPropertySymbols === "function") {
      ownKeys2 = ownKeys2.concat(
        Object.getOwnPropertySymbols(source).filter(function(sym) {
          return Object.getOwnPropertyDescriptor(source, sym).enumerable;
        })
      );
    }
    ownKeys2.forEach(function(key) {
      _define_property(target, key, source[key]);
    });
  }
  return target;
}

// ../../node_modules/@swc/helpers/esm/_object_spread_props.js
function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);
  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) {
      symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      });
    }
    keys.push.apply(keys, symbols);
  }
  return keys;
}
function _object_spread_props(target, source) {
  source = source != null ? source : {};
  if (Object.getOwnPropertyDescriptors) Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
  else {
    ownKeys(Object(source)).forEach(function(key) {
      Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
    });
  }
  return target;
}

// ../../node_modules/wasm-media-encoders/dist/es/index.mjs
var g = { mimeType: "audio/mpeg", parseParams: function(A) {
  var C2, Q, g2;
  switch (A.bitrate) {
    case void 0:
    case 8:
    case 16:
    case 24:
    case 32:
    case 40:
    case 48:
    case 64:
    case 80:
    case 96:
    case 112:
    case 128:
    case 160:
    case 192:
    case 224:
    case 256:
    case 320:
      break;
    default:
      throw Error("Invalid constant bitrate ".concat(A.bitrate));
  }
  switch (A.outputSampleRate) {
    case void 0:
    case 8e3:
    case 11025:
    case 12e3:
    case 16e3:
    case 22050:
    case 24e3:
    case 32e3:
    case 44100:
    case 48e3:
      break;
    default:
      throw Error("Invalid output sample rate ".concat(A.outputSampleRate));
  }
  if (void 0 !== A.vbrQuality && (A.vbrQuality < 0 || A.vbrQuality >= 10)) throw Error("Invalid VBR quality: ".concat(A.vbrQuality));
  let D2 = new Int32Array(3);
  return D2[0] = null !== (C2 = A.bitrate) && void 0 !== C2 ? C2 : 0, new Float32Array(D2.buffer)[1] = null !== (Q = A.vbrQuality) && void 0 !== Q ? Q : void 0 !== A.bitrate ? -1 : 4, D2[2] = null !== (g2 = A.outputSampleRate) && void 0 !== g2 ? g2 : 0, D2;
} };
var D = { mimeType: "audio/ogg", parseParams: function(A) {
  var C2;
  let Q = null !== (C2 = A.vbrQuality) && void 0 !== C2 ? C2 : 3, g2 = void 0 !== A.oggSerialNo ? Math.min(Math.max(Math.floor(A.oggSerialNo), -2147483648), 2147483647) : Math.floor(4294967296 * Math.random()) + -2147483648;
  if (Q < -1 || Q > 10) throw Error("Invalid VBR quality ".concat(Q));
  let D2 = new Int32Array(2);
  return new Float32Array(D2.buffer)[0] = Q, D2[1] = g2, D2;
} };
async function w() {
  const module = await createVorbisModule();
  return {
    enc_init: module._enc_init,
    enc_encode: module._enc_encode,
    enc_flush: module._enc_flush,
    enc_free: module._enc_free,
    enc_get_pcm: module._enc_get_pcm,
    enc_get_out_buf: module._enc_get_out_buf,
    version: module._version,
    mime_type: module._mime_type,
    malloc: module._malloc,
    free: module._free,
    getInt32Array(ptr, length) { return new Int32Array(module.HEAP32.buffer, ptr, length); },
    getFloat32Array(ptr, length) { return new Float32Array(module.HEAPF32.buffer, ptr, length); },
    getUint8Array(ptr, length) { return new Uint8Array(module.HEAPU8.buffer, ptr, length); },
    getString(ptr) { return module.UTF8ToString(ptr); }
  };
}
var B = { [g.mimeType]: g, [D.mimeType]: D };
var E = class C {
  get_pcm(A) {
    let C2 = this.module.enc_get_pcm(this.ref, A);
    if (!C2) throw Error("PCM buffer allocation failed");
    let Q = this.module.getInt32Array(C2, this.channelCount);
    return Array.from({ length: this.channelCount }, (C3, g2) => this.module.getFloat32Array(Q[g2], A));
  }
  get_out_buf(A) {
    let C2 = this.module.enc_get_out_buf(this.ref);
    return this.module.getUint8Array(C2, A);
  }
  get_common_params(A) {
    switch (A.channels) {
      case 1:
      case 2:
        break;
      default:
        throw Error("Invalid channel count: ".concat(A.channels, ". ").concat(this.mimeType, " supports 1 or 2 channels."));
    }
    if ("number" != typeof A.sampleRate) throw Error("Invalid sample rate: ".concat(A.sampleRate));
    return new Uint32Array([A.channels, A.sampleRate]);
  }
  static async create(A, Q, g2) {
    return new C(A, await w(Q), B[A].parseParams, g2);
  }
  configure(A) {
    this.ref && (this.module.enc_free(this.ref), this.ref = 0);
    let C2 = this.get_common_params(A), Q = this.parseParams(A), g2 = this.module.malloc(C2.byteLength + Q.byteLength);
    if (!g2) throw Error("Failed to allocate parameter buffer");
    this.module.getInt32Array(g2, C2.length).set(C2), this.module.getInt32Array(g2 + C2.byteLength, Q.length).set(Q), this.channelCount = A.channels;
    try {
      if (this.ref = this.module.enc_init(g2), !this.ref) throw Error("Encoder initialization failed");
    } finally {
      this.module.free(g2);
    }
  }
  encode(A) {
    if (A.length !== this.channelCount) throw Error("encode must be called with channel number (".concat(this.channelCount, ") of Float32Arrays"));
    let C2 = this.get_pcm(A[0].length);
    C2.forEach((C3, Q2) => C3.set(A[Q2]));
    let Q = this.module.enc_encode(this.ref, C2[0].length);
    if (Q < 0) throw Error("Error while encoding: ".concat(Q));
    return this.get_out_buf(Q);
  }
  finalize() {
    let A = this.module.enc_flush(this.ref);
    if (A < 0) throw Error("Error while encoding: ".concat(A));
    return this.get_out_buf(A);
  }
  constructor(C2, Q, g2, D2) {
    _define_property(this, "mimeType", void 0), _define_property(this, "module", void 0), _define_property(this, "parseParams", void 0), _define_property(this, "ref", void 0), _define_property(this, "channelCount", void 0), this.mimeType = C2, this.module = Q, this.parseParams = g2;
    let w2 = this.module.version ? this.module.getString(this.module.version()) : "unknown (< 0.7.0)", B2 = this.module.getString(this.module.mime_type()), E2 = M();
    if (null == D2 || D2(Q.module, w2, B2), E2 != w2) throw Error("JS and WASM version mismatch. JS version: ".concat(E2, " WASM version: ").concat(w2));
    if (C2 != B2) throw Error("Loaded incorrect WASM for MIME type. JS expected ".concat(C2, ", WASM is ").concat(B2));
  }
};
var I = E.create;
var M = function() {
  return "".concat("wasm-media-encoders", "-").concat("0.7.0");
};
function s() {
  return I("audio/ogg");
}

// src/ogg-encode.src.js
async function ogg(opts) {
  let { sampleRate, quality = 3, channels, stream, meta } = opts;
  let enc = await s();
  let nch = channels || 0;
  let tag = stream && meta ? (await Promise.resolve().then(() => (init_meta(), meta_exports))).metaStream(meta) : (b) => b;
  if (nch) enc.configure({ sampleRate, channels: nch, vbrQuality: quality });
  return { encode: (ch) => tag(encode(ch)), flush: () => tag(flush()), free };
  function encode(ch) {
    if (!nch) {
      nch = ch.length;
      enc.configure({ sampleRate, channels: nch, vbrQuality: quality });
    }
    let raw = enc.encode(ch);
    return new Uint8Array(raw);
  }
  function flush() {
    let raw = enc.finalize();
    return new Uint8Array(raw);
  }
  function free() {
    if (enc && enc.ref) {
      const ref = enc.ref;
      enc.ref = 0;
      try {
        enc.module.enc_free(ref);
      } finally {
        enc = null;
      }
      return;
    }
    enc = null;
  }
}
export {
  ogg as default
};
