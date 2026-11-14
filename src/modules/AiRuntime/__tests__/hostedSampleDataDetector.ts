/** What the wire may carry per band map: one number for each of the seven frequency bands. */
export const MAX_BAND_VALUES = 7;

/** A body that is, or carries as keys or encoded text, anything other than the figures a receipt reports. */
const AUDIO_KEY = /^(samples?|pcm|audio|buffer|channeldata)$/iu;
const BASE64_BLOB = /^[A-Za-z0-9+/]{256,}={0,2}$/u;
const INDEX_KEY = /^\d+$/u;

/** A JSON-encoded string's value, or the string itself when it does not encode JSON. */
export function parseEncodedJson(value: string): unknown {
    if (!/^\s*[[{]/u.test(value)) {
        return value;
    }
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
}

/**
 * Whether a hosted request body carries sample data anywhere, JSON-encoded strings included: a typed
 * array, a base64 blob, a number series longer than a band map, an object keyed by index (how a
 * typed array serializes) or an audio-named key.
 */
export function containsSampleData(value: unknown): boolean {
    if (ArrayBuffer.isView(value)) {
        return true;
    }
    if (typeof value === 'string') {
        const decoded = parseEncodedJson(value);
        return decoded === value ? BASE64_BLOB.test(value) : containsSampleData(decoded);
    }
    if (Array.isArray(value)) {
        const isNumberSeries = value.length > MAX_BAND_VALUES && value.every((entry) => typeof entry === 'number');
        return isNumberSeries || value.some(containsSampleData);
    }
    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value);
        // A typed array serializes as an object keyed by index.
        const isIndexedSeries = entries.length > MAX_BAND_VALUES && entries.every(([key]) => INDEX_KEY.test(key));
        return isIndexedSeries || entries.some(([key, entry]) => AUDIO_KEY.test(key) || containsSampleData(entry));
    }
    return false;
}
