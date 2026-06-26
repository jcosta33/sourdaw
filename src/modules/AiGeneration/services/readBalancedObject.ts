/**
 * Read the balanced-brace JSON object starting at `start` (which must point at
 * a `{`), or null if it never closes. String literals (with escapes) are
 * tracked so braces inside strings don't skew the depth count.
 *
 * Shared by the LLM response parsers in `llmMidiGeneration` (marker `"notes"`)
 * and `generateMidiVariations` (marker `"variations"`): both walk the raw model
 * output for the first balanced object carrying their marker, so the scanner
 * lives here once rather than drifting in two verbatim copies.
 */
export function readBalancedObject(text: string, start: number): string | null {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index++) {
        const char = text[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(start, index + 1);
            }
        }
    }

    return null;
}
