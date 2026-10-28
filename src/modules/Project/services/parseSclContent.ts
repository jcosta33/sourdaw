import {
    type ParseSclError,
    type ParseSclResult,
    STANDARD_A4_ROOT_FREQ,
    STANDARD_A4_ROOT_NOTE,
} from '../models/ScalaTuning';

type InvalidScale = Extract<ParseSclResult, { status: 'invalid' }>;
type ToneResult = { status: 'parsed'; cents: number } | InvalidScale;
type SourceLine = { line: number; text: string };

const U32_MAX = 4_294_967_295n;
// The native parser uses usize on the shipped arm64/x64 desktop targets.
const NATIVE_USIZE_MAX = 18_446_744_073_709_551_615n;
const DECIMAL_FLOAT = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/u;

function invalid(kind: ParseSclError['kind'], line: number, reason: string): InvalidScale {
    return { status: 'invalid', error: { kind, line, reason } };
}

function parseUnsigned(text: string, maximum: bigint): bigint | null {
    const start = text.startsWith('+') ? 1 : 0;
    if (start === text.length) {
        return null;
    }
    let value = 0n;
    for (let index = start; index < text.length; index++) {
        const digit = text.charCodeAt(index) - 48;
        if (digit < 0 || digit > 9) {
            return null;
        }
        value = value * 10n + BigInt(digit);
        if (value > maximum) {
            return null;
        }
    }
    return value;
}

function ratioCents(numerator: bigint, denominator: bigint, line: number): ToneResult {
    if (numerator === 0n) {
        return invalid('zero-numerator', line, 'Zero numerator in ratio');
    }
    if (denominator === 0n) {
        return invalid('zero-denominator', line, 'Zero denominator in ratio');
    }
    return { status: 'parsed', cents: 1200 * Math.log2(Number(numerator) / Number(denominator)) };
}

function parseTone({ line, text }: SourceLine): ToneResult {
    if (text.includes('.')) {
        if (!DECIMAL_FLOAT.test(text)) {
            return invalid('invalid-cents', line, 'Invalid cents value');
        }
        const cents = Number(text);
        if (!Number.isFinite(cents)) {
            return invalid('invalid-cents', line, 'Cents value must be finite');
        }
        return { status: 'parsed', cents };
    }

    const slash = text.indexOf('/');
    if (slash >= 0) {
        const denominatorText = text.slice(slash + 1);
        if (denominatorText.includes('/')) {
            return invalid('invalid-ratio', line, 'Invalid ratio');
        }
        const numerator = parseUnsigned(text.slice(0, slash), U32_MAX);
        if (numerator === null) {
            return invalid('invalid-numerator', line, 'Invalid numerator');
        }
        const denominator = parseUnsigned(denominatorText, U32_MAX);
        if (denominator === null) {
            return invalid('invalid-denominator', line, 'Invalid denominator');
        }
        return ratioCents(numerator, denominator, line);
    }

    const numerator = parseUnsigned(text, U32_MAX);
    if (numerator === null) {
        return invalid('invalid-integer-ratio', line, 'Invalid integer ratio');
    }
    return ratioCents(numerator, 1n, line);
}

function defaultFrequencies(): number[] {
    return Array.from({ length: 128 }, (_, note) => STANDARD_A4_ROOT_FREQ * 2 ** ((note - STANDARD_A4_ROOT_NOTE) / 12));
}

function buildFrequencies(degreeCents: number[]): number[] {
    const count = degreeCents.length;
    if (count === 0) {
        return defaultFrequencies();
    }
    const periodCents = degreeCents[count - 1]!;
    const frequencies: number[] = [];
    for (let note = 0; note < 128; note++) {
        const difference = note - STANDARD_A4_ROOT_NOTE;
        const periods = Math.floor(difference / count);
        const degree = difference - periods * count;
        const cents = periods * periodCents + (degree === 0 ? 0 : degreeCents[degree - 1]!);
        const frequency = STANDARD_A4_ROOT_FREQ * 2 ** (cents / 1200);
        if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(Math.log2(frequency))) {
            const value = frequency === Infinity ? 'inf' : String(frequency);
            throw new Error(`Scale produces a non-finite frequency at MIDI note ${note}: ${value}`);
        }
        frequencies.push(frequency);
    }
    return frequencies;
}

export function parseSclContent(content: string): ParseSclResult {
    const physicalLines = content.length === 0 ? [] : content.split('\n');
    if (content.endsWith('\n')) {
        physicalLines.pop();
    }
    const eofLine = physicalLines.length + 1;
    const lines = physicalLines
        // Rust str::trim uses White_Space; JS trim also removes BOM and misses NEL.
        .map((text, index) => ({ line: index + 1, text: text.replaceAll(/^\p{White_Space}+|\p{White_Space}+$/gu, '') }))
        .filter(({ text }) => text.length > 0 && !text.startsWith('!'));
    const description = lines[0];
    if (!description) {
        return invalid('missing-description', eofLine, 'Missing description line');
    }
    const countLine = lines[1];
    if (!countLine) {
        return invalid('missing-count', eofLine, 'Missing count line');
    }
    const count = parseUnsigned(countLine.text, NATIVE_USIZE_MAX);
    if (count === null) {
        return invalid('invalid-count', countLine.line, 'Invalid tone count');
    }
    if (count > BigInt(lines.length - 2)) {
        return invalid('count-mismatch', countLine.line, 'Declared tone count exceeds the supplied tones');
    }

    const degreeCents: number[] = [];
    for (const source of lines.slice(2, 2 + Number(count))) {
        const tone = parseTone(source);
        if (tone.status === 'invalid') {
            return tone;
        }
        degreeCents.push(tone.cents);
    }
    return {
        status: 'parsed',
        scale: { name: 'Unnamed', description: description.text, frequencies: buildFrequencies(degreeCents) },
    };
}
