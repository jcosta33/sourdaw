/**
 * Line-range slicing shared by evidence admission and admission ordering.
 *
 * The two consumers must agree on what a hunk range names, so the clamping and the empty-slice case
 * live here rather than in either caller.
 */

/** A contiguous run of lines in one revision of one file. */
export type LineRange = { readonly startLine: number; readonly endLine: number };

export function splitLines(text: string): string[] {
    return text.split('\n');
}

/** The named lines of `text`, clamped to what the file holds, or `undefined` when none remain. */
export function sliceLines(text: string, range: LineRange): { text: string; range: LineRange } | undefined {
    const lines = splitLines(text);
    // A hunk that starts past the file's last line names no line this revision holds; clamping it to
    // the last line would admit a region the diff never described. `splitLines` never returns empty,
    // so this is the only way a range can leave no line.
    if (range.startLine > lines.length) {
        return undefined;
    }
    const last = Math.max(1, lines.length);
    const start = Math.min(Math.max(1, range.startLine), last);
    const end = Math.min(Math.max(start, range.endLine), last);
    const slice = lines.slice(start - 1, end);
    return slice.length === 0 ? undefined : { text: slice.join('\n'), range: { startLine: start, endLine: end } };
}
