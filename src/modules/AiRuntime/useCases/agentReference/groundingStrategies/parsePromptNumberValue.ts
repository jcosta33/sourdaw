/** Parse one complete numeric prompt token, including a finite fraction. */
export function parsePromptNumberValue(raw: string): number | null {
    if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))?$/u.test(raw)) {
        return null;
    }
    const [rawNumerator, rawDenominator] = raw.split('/');
    const numerator = Number(rawNumerator);
    if (rawDenominator === undefined) {
        return Number.isFinite(numerator) ? numerator : null;
    }
    const denominator = Number(rawDenominator);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return null;
    }
    return numerator / denominator;
}
