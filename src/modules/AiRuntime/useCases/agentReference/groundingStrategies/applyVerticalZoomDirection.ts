import { type PromptNumber } from './classifyPromptDecibelFigures';
import { normalizePromptText } from './normalizePromptText';

const GROWING_WORDS: readonly string[] = ['taller', 'bigger', 'larger', 'in', 'up'];
const SHRINKING_WORDS: readonly string[] = ['shorter', 'smaller', 'out', 'down'];

/**
 * A row-height change is signed by the words that say which way it goes: taller, bigger, larger, in
 * and up grow it; shorter, smaller, out and down shrink it. A figure the request signs itself keeps
 * that sign, and a request naming both ways or neither keeps the figure as stated.
 */
export function applyVerticalZoomDirection(value: number, number: PromptNumber, maskedScope: string): number {
    if (/^[+-]/u.test(number.raw)) {
        return value;
    }
    const words = normalizePromptText(maskedScope).split(' ');
    const grows = words.some((word) => GROWING_WORDS.includes(word));
    const shrinks = words.some((word) => SHRINKING_WORDS.includes(word));
    if (grows === shrinks) {
        return value;
    }
    return grows ? Math.abs(value) : -Math.abs(value);
}
