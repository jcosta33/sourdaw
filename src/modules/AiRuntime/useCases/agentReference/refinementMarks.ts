import { findPromptNumbers } from './groundingStrategies/findPromptNumbers';

/**
 * A sign spoken or typeset before the figure, touching it or a space away: "minus 1.5 dB", and any
 * dash or minus character — "-", "–" (U+2013), "‑" (U+2011), "−" (U+2212) — as in "by – 1.5 dB".
 */
const SIGN_MARK = /(?:\b(minus|plus)\s+|([\p{Pd}−])\s*)$/iu;
/**
 * A symbol or punctuation mark: beside a figure it may be a sign this reading does not read ("➖",
 * "⁻", "＋"). The glyph a masked object name is written in is no such mark.
 */
const UNREAD_MARK = /[\p{S}\p{P}]/u;
const PROJECT_REFERENCE_MASK_GLYPH = '□';

/** The sign a figure's preceding text closes on, as `SIGN_MARK` reads it, or `null` for none. */
function readSignBefore(before: string): RegExpExecArray | null {
    return SIGN_MARK.exec(before);
}

/**
 * A mark anywhere in the clause outside the object names it states that is none of the ones its figure
 * is read by: the decimal mark and percent sign inside the figure, and the sign before it. The text it
 * is read in leaves out the figure, its read sign and its unit word, so any other symbol or punctuation
 * mark, touching the figure or not ("2 dB ↑", "2 dB+", "2 dB 🔊"), may state a sign or direction this
 * reading does not read.
 */
function findUnreadMark(text: string): string | null {
    return (
        Array.from(text).find(
            (character) => character !== PROJECT_REFERENCE_MASK_GLYPH && UNREAD_MARK.test(character)
        ) ?? null
    );
}

/** A quotation of object names alone ("the "Bass" track"), read as the names it quotes. */
const QUOTED_NAMES = /["“'‘]\s*(?:□|clip)[\s□]*["”'’]/gu;
/** An apostrophe inside a word ("don't", "let's", "that's"), read with the word it joins. */
const WORD_APOSTROPHE = /(?<=\p{L})['’](?=\p{L})/gu;
/** A percent sign a space after its figure ("50 %"), which states the figure's unit. */
const SPACED_PERCENT = /^\s+%/u;

/** The text with each span blanked, so the marks left are the ones no reading of the clause reads. */
function blankSpans(text: string, spans: ReadonlyArray<readonly [number, number]>): string {
    const characters = text.split('');
    for (const [from, to] of spans) {
        characters.fill(' ', from, to);
    }
    return characters.join('');
}

/** The spans of every figure in a masked clause, with the sign read before it and a percent sign after it. */
function readFigureSpans(masked: string): Array<readonly [number, number]> {
    return findPromptNumbers(masked).map((number) => {
        const signMark = readSignBefore(masked.slice(0, number.index));
        const percent = SPACED_PERCENT.exec(masked.slice(number.end));
        return [signMark?.index ?? number.index, number.end + (percent?.[0].length ?? 0)] as const;
    });
}

/**
 * The first mark a masked clause holds that no reading of the refinement grammar reads, on any clause kind:
 * outside the object names the masking hides, quoted or not, each figure's own decimal mark,
 * percent sign and read sign, and an apostrophe inside a word. The splitter has already cut the clause
 * at its commas, semicolons and full stops.
 */
function findClauseUnreadMark(masked: string): string | null {
    const unquoted = blankSpans(
        masked,
        Array.from(masked.matchAll(QUOTED_NAMES), (match) => [match.index, match.index + match[0].length])
    );
    const read = blankSpans(unquoted, [
        ...readFigureSpans(unquoted),
        ...Array.from(unquoted.matchAll(WORD_APOSTROPHE), (match) => [match.index, match.index + 1] as const),
    ]);
    return findUnreadMark(read);
}

/**
 * The marks a refinement clause is read by — a figure's sign, decimal mark and percent sign, the glyph
 * a masked object name is written in, an apostrophe inside a word — and every other mark, which the
 * grammar does not read.
 */
export const refinementMarks = {
    signBefore: readSignBefore,
    unreadIn: findUnreadMark,
    unreadInClause: findClauseUnreadMark,
} as const;
