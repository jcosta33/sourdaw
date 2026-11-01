/**
 * Raw Opus packet encoder — libopus WASM (single-file module, host-neutral).
 * Container muxers (Ogg in this package, WebM in @audio/encode-webm) build on it.
 *
 * let enc = await createOpusEncoder({ channels: 2, bitrate: 96 })
 * enc.lookahead            // encoder delay in 48 kHz samples — the Ogg pre-skip / Matroska CodecDelay
 * enc.encode(frame)        // interleaved float PCM at 48 kHz, 960 samples per channel → Uint8Array packet
 * enc.free()
 */
import createModule from './src/opus.wasm.js'

export const OPUS_RATE = 48000
export const FRAME = 960 // 20 ms at 48 kHz
const APP = { audio: 2049, voip: 2048, lowdelay: 2051 }
// libopus CTL request codes (opus_defines.h)
const SET_BITRATE = 4002, SET_COMPLEXITY = 4010
const ERRORS = ['OK', 'OPUS_BAD_ARG', 'OPUS_BUFFER_TOO_SMALL', 'OPUS_INTERNAL_ERROR', 'OPUS_INVALID_PACKET', 'OPUS_UNIMPLEMENTED', 'OPUS_INVALID_STATE', 'OPUS_ALLOC_FAIL']

let modP
function getModule() {
	if (modP) return modP
	let p = createModule()
	modP = p
	return p.catch(e => { modP = null; throw e })
}

/**
 * @param {{ channels?: number, bitrate?: number, application?: 'audio'|'voip'|'lowdelay', complexity?: number }} opts
 */
export async function createOpusEncoder(opts = {}) {
	let m = await getModule()
	let channels = opts.channels || 1
	if (channels !== 1 && channels !== 2) throw Error('Opus encoder supports 1 or 2 channels')
	let app = APP[opts.application || 'audio']
	if (!app) throw Error('Unknown application: ' + opts.application)

	let h = m._audio_opus_enc_create(OPUS_RATE, channels, app)
	if (!h) throw Error('libopus ' + errName(m._audio_opus_enc_last_error()))
	check(m._audio_opus_enc_set(h, SET_BITRATE, (opts.bitrate || 64) * 1000))
	check(m._audio_opus_enc_set(h, SET_COMPLEXITY, opts.complexity ?? 10))
	let lookahead = check(m._audio_opus_enc_lookahead(h))
	let input = m._audio_opus_enc_input(h) >> 2 // float index into HEAPF32

	return {
		channels,
		lookahead,
		/** @param {Float32Array} frame interleaved, FRAME * channels samples */
		encode(frame) {
			if (!h) throw Error('Encoder already freed')
			if (frame.length !== FRAME * channels) throw Error('Opus frame must hold ' + FRAME + ' samples per channel')
			m.HEAPF32.set(frame, input)
			let n = check(m._audio_opus_enc_encode(h, FRAME))
			let out = m._audio_opus_enc_output(h)
			return m.HEAPU8.slice(out, out + n)
		},
		free() {
			if (!h) return
			m._audio_opus_enc_destroy(h)
			h = 0
		}
	}
}

function errName(code) { return code + ' ' + (ERRORS[-code] || 'UNKNOWN_ERROR') }
function check(code) { if (code < 0) throw Error('libopus ' + errName(code)); return code }

/** Resample planar float channels to interleaved 48 kHz (Lanczos-3; passthrough at 48 kHz). */
export function toOpusRate(channels, rate) {
	let nch = channels.length, len = channels[0].length
	let ratio = OPUS_RATE / rate
	let outLen = ratio === 1 ? len : Math.round(len * ratio)
	let out = new Float32Array(outLen * nch)
	for (let i = 0, o = 0; i < outLen; i++) {
		let x = i / ratio
		for (let c = 0; c < nch; c++) out[o++] = ratio === 1 ? channels[c][i] : lanczos(channels[c], x, len)
	}
	return out
}

function lanczos(ch, x, len) {
	let a = 3, sum = 0, wsum = 0
	let i0 = Math.floor(x) - a + 1
	let i1 = Math.floor(x) + a
	for (let i = i0; i <= i1; i++) {
		let d = x - i
		let w = d === 0 ? 1 : a * Math.sin(Math.PI * d) * Math.sin(Math.PI * d / a) / (Math.PI * Math.PI * d * d)
		let idx = i < 0 ? 0 : i >= len ? len - 1 : i
		sum += ch[idx] * w
		wsum += w
	}
	return wsum ? sum / wsum : 0
}
