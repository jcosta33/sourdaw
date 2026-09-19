/** Parse one complete numeric prompt token, including a finite fraction. */
export function parsePromptNumberValue(raw: string): number | null {
    const parts = raw.split('/');
    const numerator = Number.parseFloat(parts[0] ?? '');
    if (parts.length === 1) {
        return Number.isFinite(numerator) ? numerator : null;
    }
    const denominator = Number.parseFloat(parts[1] ?? '');
    if (parts.length !== 2 || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
        return null;
    }
    return numerator / denominator;
}
