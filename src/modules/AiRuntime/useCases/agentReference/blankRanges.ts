import { type Range } from './readProtectionSlots';

/** Replace each range with equal-length filler so offsets into the original text stay valid. */
export function blankRanges(text: string, ranges: readonly Range[]): string {
    return ranges.reduce(
        (blanked, { start, end }) => `${blanked.slice(0, start)}${'□'.repeat(end - start)}${blanked.slice(end)}`,
        text
    );
}
