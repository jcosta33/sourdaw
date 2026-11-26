/**
 * Whether the masking left a span exactly as the text wrote it. The mask writes a four-character clip
 * name as `clip` alone, so a masked span whose text is its masked form is the word "clip" written in the
 * request, never a project name.
 */
export function isLeftAsWritten(text: string, masked: string, span: { start: number; end: number }): boolean {
    return text.slice(span.start, span.end) === masked.slice(span.start, span.end);
}
