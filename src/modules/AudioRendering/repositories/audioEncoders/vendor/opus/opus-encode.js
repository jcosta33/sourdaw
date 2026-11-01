/**
 * Ogg Opus encoder — libopus WASM (single-file module, host-neutral) + minimal Ogg muxer (RFC 7845).
 *
 * @param {Object} opts
 * @param {number} opts.sampleRate - input sample rate (any rate; resampled to 48 kHz)
 * @param {number} [opts.channels=1] - 1 or 2
 * @param {number} [opts.bitrate=64] - kbps
 * @param {string} [opts.application='audio'] - 'audio', 'voip', or 'lowdelay'
 * @param {number} [opts.complexity=10] - 0-10, libopus encoder effort
 * @param {object} [opts.meta] - VorbisComment tags (title, artist, …) baked into OpusTags
 * @returns {{ encode, flush, free }}
 *
 * encode(channels: Float32Array[]) -> Uint8Array (Ogg pages for this chunk)
 * flush() -> Uint8Array (remaining pages + EOS)
 * free() -> void
 */
import { createOpusEncoder, toOpusRate, FRAME } from './core.js'

export default async function opus(opts) {
	let rate = opts.sampleRate
	if (!rate) throw Error('sampleRate is required')
	let nch = opts.channels || 1
	let enc = await createOpusEncoder({ channels: nch, bitrate: opts.bitrate, application: opts.application, complexity: opts.complexity })
	let preSkip = enc.lookahead

	let serial = (Math.random() * 0xFFFFFFFF) >>> 0
	let pageSeq = 0
	let granule = 0      // samples encoded so far (48 kHz)
	let total = 0        // input samples received (48 kHz)
	let pcm = new Float32Array(0) // pending interleaved 48 kHz samples
	let headerSent = false

	// header pages (BOS + tags). Metadata is baked into OpusTags — no buffering.
	let headerPages = [
		oggPage(opusHead(nch, preSkip, rate), serial, pageSeq++, 0, 0x02),
		oggPage(opusTags(metaToComments(opts.meta)), serial, pageSeq++, 0, 0x00)
	]

	return { encode: encodeChunk, flush, free }

	function encodeChunk(channels) {
		if (!enc) throw Error('Encoder already freed')
		let next = toOpusRate(channels, rate)
		total += next.length / nch
		if (pcm.length) { let joined = new Float32Array(pcm.length + next.length); joined.set(pcm); joined.set(next, pcm.length); next = joined }
		pcm = next

		let pages = headers()
		let frameLen = FRAME * nch, pos = 0
		while (pcm.length - pos >= frameLen) {
			pages.push(page(pcm.subarray(pos, pos + frameLen), 0x00))
			pos += frameLen
		}
		pcm = pcm.subarray(pos).slice()
		return concat(pages)
	}

	function flush() {
		if (!enc) throw Error('Encoder already freed')
		let pages = headers()
		// Pad so the encoder delay (pre-skip) is pushed out, then trim via the final granule (RFC 7845 §4.4).
		let need = total + preSkip - granule
		let frames = Math.max(1, Math.ceil(need / FRAME))
		let padded = new Float32Array(frames * FRAME * nch)
		padded.set(pcm)
		pcm = new Float32Array(0)
		for (let i = 0; i < frames; i++) {
			let last = i === frames - 1
			pages.push(page(padded.subarray(i * FRAME * nch, (i + 1) * FRAME * nch), last ? 0x04 : 0x00, last ? total + preSkip : 0))
		}
		free()
		return concat(pages)
	}

	function free() {
		if (!enc) return
		enc.free()
		enc = null
		pcm = null
		headerPages = null
	}

	function headers() {
		if (headerSent) return []
		headerSent = true
		return headerPages
	}

	// encode one 20 ms frame → one Ogg page
	function page(frame, flags, endGranule) {
		let packet = enc.encode(frame)
		granule += FRAME
		return oggPage(packet, serial, pageSeq++, endGranule || granule, flags)
	}
}

function concat(parts) {
	if (parts.length === 1) return parts[0]
	let len = 0
	for (let p of parts) len += p.length
	let out = new Uint8Array(len), off = 0
	for (let p of parts) { out.set(p, off); off += p.length }
	return out
}


// --- Ogg muxer ---

function oggPage(payload, serial, seq, granule, flags) {
	let segs = []
	let rem = payload.length
	while (rem >= 255) { segs.push(255); rem -= 255 }
	segs.push(rem)

	let hdrLen = 27 + segs.length
	let page = new Uint8Array(hdrLen + payload.length)
	let dv = new DataView(page.buffer)

	page[0] = 0x4F; page[1] = 0x67; page[2] = 0x67; page[3] = 0x53 // "OggS"
	page[4] = 0       // version
	page[5] = flags

	// granule (int64 LE)
	dv.setUint32(6, granule >>> 0, true)
	dv.setUint32(10, Math.floor(granule / 0x100000000) >>> 0, true)

	dv.setUint32(14, serial, true)
	dv.setUint32(18, seq, true)
	dv.setUint32(22, 0, true) // CRC placeholder

	page[26] = segs.length
	for (let i = 0; i < segs.length; i++) page[27 + i] = segs[i]
	page.set(payload, hdrLen)

	dv.setUint32(22, oggCrc(page), true)
	return page
}

function opusHead(ch, preSkip, inputRate) {
	let b = new Uint8Array(19)
	let d = new DataView(b.buffer)
	set8(b, 0, 'OpusHead')
	b[8] = 1          // version
	b[9] = ch          // channels
	d.setUint16(10, preSkip, true)
	d.setUint32(12, inputRate, true)
	d.setInt16(16, 0, true) // output gain
	b[18] = 0          // channel mapping family 0
	return b
}

// VorbisComment field map (shared shape with FLAC/Vorbis)
const VORBIS_MAP = {
	title: 'TITLE', artist: 'ARTIST', album: 'ALBUM', albumartist: 'ALBUMARTIST',
	composer: 'COMPOSER', genre: 'GENRE', year: 'DATE', track: 'TRACKNUMBER',
	disc: 'DISCNUMBER', bpm: 'BPM', key: 'KEY', comment: 'COMMENT',
	copyright: 'COPYRIGHT', isrc: 'ISRC', publisher: 'PUBLISHER', software: 'ENCODER',
	lyrics: 'LYRICS'
}

function metaToComments(meta) {
	if (!meta) return []
	let out = []
	for (let k in VORBIS_MAP) {
		let v = meta[k]
		if (v == null || v === '') continue
		out.push(VORBIS_MAP[k] + '=' + v)
	}
	return out
}

const TE = new TextEncoder()

function opusTags(comments = []) {
	let vendor = TE.encode('audio-encode')
	let entries = comments.map(c => TE.encode(c))
	let size = 8 + 4 + vendor.length + 4
	for (let e of entries) size += 4 + e.length
	let b = new Uint8Array(size)
	let d = new DataView(b.buffer)
	set8(b, 0, 'OpusTags')
	let pos = 8
	d.setUint32(pos, vendor.length, true); pos += 4
	b.set(vendor, pos); pos += vendor.length
	d.setUint32(pos, entries.length, true); pos += 4
	for (let e of entries) {
		d.setUint32(pos, e.length, true); pos += 4
		b.set(e, pos); pos += e.length
	}
	return b
}

function set8(buf, off, str) {
	for (let i = 0; i < str.length; i++) buf[off + i] = str.charCodeAt(i)
}

// Ogg CRC32: direct, poly=0x04C11DB7, init=0, xorOut=0
let crcTbl
function oggCrc(data) {
	if (!crcTbl) {
		crcTbl = new Uint32Array(256)
		for (let i = 0; i < 256; i++) {
			let r = i << 24
			for (let j = 0; j < 8; j++) {
				r = (r & 0x80000000) ? ((r << 1) ^ 0x04C11DB7) : (r << 1)
				r >>>= 0
			}
			crcTbl[i] = r >>> 0
		}
	}
	let crc = 0
	for (let i = 0; i < data.length; i++) crc = ((crc << 8) ^ crcTbl[((crc >>> 24) ^ data[i]) & 0xFF]) >>> 0
	return crc
}
