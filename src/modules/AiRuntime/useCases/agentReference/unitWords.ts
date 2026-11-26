/** Each unit a figure may be stated in, by its canonical spelling, and the words that spell it. */
const UNIT_WORDS: ReadonlyArray<{ unit: string; pattern: RegExp }> = [
    { unit: '%', pattern: /^\s*(?:%|percent|per\s+cent)(?![\p{L}\p{N}])/iu },
    { unit: 'dB', pattern: /^\s*(?:d\s?b|decibels?)(?![\p{L}\p{N}])/iu },
    { unit: 'kHz', pattern: /^\s*(?:khz|kilohertz)(?![\p{L}\p{N}])/iu },
    { unit: 'Hz', pattern: /^\s*(?:hz|hertz)(?![\p{L}\p{N}])/iu },
    { unit: 'bpm', pattern: /^\s*bpm(?![\p{L}\p{N}])/iu },
    { unit: 'ms', pattern: /^\s*(?:ms|milliseconds?)(?![\p{L}\p{N}])/iu },
    { unit: 'beats', pattern: /^\s*beats?(?![\p{L}\p{N}])/iu },
    { unit: 'bars', pattern: /^\s*bars?(?![\p{L}\p{N}])/iu },
    { unit: 'semitones', pattern: /^\s*semitones?(?![\p{L}\p{N}])/iu },
    { unit: 'cents', pattern: /^\s*cents?(?![\p{L}\p{N}])/iu },
    { unit: 's', pattern: /^\s*(?:s|secs?|seconds?)(?![\p{L}\p{N}])/iu },
];

/** The unit word a text opens with, by its canonical spelling, and how much of the text it takes. */
export function readUnitWord(text: string): { unit: string; length: number } | null {
    for (const { unit, pattern } of UNIT_WORDS) {
        const match = pattern.exec(text);
        if (match !== null) {
            return { unit, length: match[0].length };
        }
    }
    return null;
}
