import { type Range } from './readProtectionSlots';

/**
 * Replace each range with equal-length filler so offsets into the original text stay valid: the
 * mask glyph by default, which later readers see as a masked reference, or a space, which reads as
 * no word at all.
 */
export function blankRanges(text: string, ranges: readonly Range[], filler = '□'): string {
    return ranges.reduce(
        (blanked, { start, end }) => `${blanked.slice(0, start)}${filler.repeat(end - start)}${blanked.slice(end)}`,
        text
    );
}
