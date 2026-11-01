/** Names are attributed data, including digits, units and Markdown metacharacters. */
export function quoteSourceData(value: string): string {
    return `“${value.replaceAll(/[\\`*_{}[\]()<>!#|~]/g, '\\$&').replaceAll(/[\r\n]/g, ' ')}”`;
}

/** Answer figures round to two decimals; negative zero reads as 0. */
export function formatAnswerNumber(value: number): string {
    if (!Number.isFinite(value)) {
        return 'unavailable';
    }
    const rounded = Math.round(value * 100) / 100;
    return String(Object.is(rounded, -0) ? 0 : rounded);
}
