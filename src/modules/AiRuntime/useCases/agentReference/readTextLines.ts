import { type AgentReferenceTextRange } from './findAgentReferenceNameSpans';

/** The non-empty lines of the text within the range, in order, each with its place in the whole text. */
export function readTextLines(text: string, { start, end }: AgentReferenceTextRange): AgentReferenceTextRange[] {
    return Array.from(text.slice(start, end).matchAll(/[^\n]+/gu), (line) => ({
        start: start + line.index,
        end: start + line.index + line[0].length,
    }));
}
