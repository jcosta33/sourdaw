/** What the wire may carry per band map: one number for each of the seven frequency bands. */
export const MAX_BAND_VALUES = 7;

/** A body that is, or carries as keys or encoded text, anything other than the figures a receipt reports. */
const AUDIO_KEY = /^(samples?|pcm|audio|buffer|channeldata)$/iu;
const BASE64_BLOB = /^[A-Za-z0-9+/]{256,}={0,2}$/u;
const INDEX_KEY = /^\d+$/u;
/** A series or blob inside running text, which a message composed around a figure list leaves unparsed. */
const NUMBER = String.raw`-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`;
const EMBEDDED_NUMBER_SERIES = new RegExp(
    String.raw`\[(?:\s*${NUMBER}\s*,){${String(MAX_BAND_VALUES)},}\s*${NUMBER}\s*\]`,
    'u'
);
const EMBEDDED_BASE64_BLOB = /[A-Za-z0-9+/]{256,}={0,2}/u;
/** More than a band map's figures, separated by commas or whitespace, as bare tokens in running text. */
const NUMBER_TOKEN = String.raw`(?<![\w.])${NUMBER}(?![\w.])`;
const EMBEDDED_NUMBER_LIST = new RegExp(
    String.raw`(?:${NUMBER_TOKEN}[\s,]+){${String(MAX_BAND_VALUES)},}${NUMBER_TOKEN}`,
    'u'
);
const NUMERIC_STRING = new RegExp(String.raw`^\s*${NUMBER}\s*$`, 'u');
/** A line break inside a base64 run, as MIME wraps it at 76 characters. */
const BASE64_LINE_WRAP = /(?<=[A-Za-z0-9+/=])\r?\n(?=[A-Za-z0-9+/])/gu;

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

function isNumericLeaf(value: unknown): boolean {
    return typeof value === 'number' || (typeof value === 'string' && NUMERIC_STRING.test(value));
}

/**
 * The numeric leaves under an array or object that holds nothing else, however they are split across
 * sibling arrays or keyed objects (`ch0`..`chN`); -1 when any other value sits in the tree, so a record
 * of mixed fields never adds up to a series.
 */
function countNumericLeaves(value: unknown): number {
    if (isNumericLeaf(value)) {
        return 1;
    }
    if (typeof value !== 'object' || value === null) {
        return -1;
    }
    let total = 0;
    for (const entry of Object.values(value)) {
        const count = countNumericLeaves(entry);
        if (count < 0) {
            return -1;
        }
        total += count;
    }
    return total;
}

/**
 * Whether a hosted request body carries sample data anywhere, JSON-encoded strings included: a typed
 * array, a base64 blob (also wrapped across lines), a number series longer than a band map (a
 * list, numeric strings, or numbers spread across sibling arrays or keyed objects, also inside
 * running text), an object keyed by index (how a typed array serializes) or an audio-named key.
 */
export function containsSampleData(value: unknown): boolean {
    if (ArrayBuffer.isView(value)) {
        return true;
    }
    if (typeof value === 'string') {
        const decoded = parseEncodedJson(value);
        if (decoded !== value) {
            return containsSampleData(decoded);
        }
        const unwrapped = value.replaceAll(BASE64_LINE_WRAP, '');
        return (
            BASE64_BLOB.test(unwrapped) ||
            EMBEDDED_NUMBER_SERIES.test(value) ||
            EMBEDDED_NUMBER_LIST.test(value) ||
            EMBEDDED_BASE64_BLOB.test(unwrapped)
        );
    }
    if (Array.isArray(value)) {
        return countNumericLeaves(value) > MAX_BAND_VALUES || value.some(containsSampleData);
    }
    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value);
        // A typed array serializes as an object keyed by index.
        const isIndexedSeries = entries.length > MAX_BAND_VALUES && entries.every(([key]) => INDEX_KEY.test(key));
        const isNumberSeries = countNumericLeaves(value) > MAX_BAND_VALUES;
        return (
            isIndexedSeries ||
            isNumberSeries ||
            entries.some(([key, entry]) => AUDIO_KEY.test(key) || containsSampleData(entry))
        );
    }
    return false;
}
