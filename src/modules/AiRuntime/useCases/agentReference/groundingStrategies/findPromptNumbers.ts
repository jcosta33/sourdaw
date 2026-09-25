import { type PromptNumber } from './classifyPromptDecibelFigures';

/**
 * Every complete numeric expression one scope states. A leading `+` is part of
 * the figure: "+3 dB" is a change upward, and reading it as an unsigned 3 loses
 * the only thing that says which way. Adjacent numeric fragments stay one raw
 * token even when malformed, so `1/2/3 dB` cannot authorize its suffix `3 dB`.
 */
export function findPromptNumbers(maskedScope: string): PromptNumber[] {
    const discovered = [
        ...maskedScope.matchAll(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?%?/gu),
    ];
    const numbers: PromptNumber[] = [];
    for (const match of discovered) {
        let index = match.index;
        while (index > 0 && (maskedScope[index - 1] === '+' || maskedScope[index - 1] === '-')) {
            index -= 1;
        }
        const end = match.index + match[0].length;
        const previous = numbers[numbers.length - 1];
        const separator = previous ? maskedScope.slice(previous.end, index) : '';
        const continuesPrevious =
            previous !== undefined &&
            ((separator === '' && /^[.+-]/u.test(maskedScope.slice(index, end))) ||
                /^\s*\/[-\s/+.]*$/u.test(separator) ||
                /^[.+-]+$/u.test(separator));
        if (continuesPrevious) {
            previous.end = end;
            previous.raw = maskedScope.slice(previous.index, end);
            continue;
        }
        numbers.push({ end, index, raw: maskedScope.slice(index, end) });
    }
    for (const number of numbers) {
        const incompleteFraction = /^\s*\/\s*[+-]*(?=[^\d.]|$)/u.exec(maskedScope.slice(number.end));
        if (!incompleteFraction) {
            continue;
        }
        number.end += incompleteFraction[0].length;
        number.raw = maskedScope.slice(number.index, number.end);
    }
    return numbers;
}
