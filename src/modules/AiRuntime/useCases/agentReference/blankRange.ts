import { type AgentReferenceTextRange } from './findAgentReferenceNameSpans';

/** The text with the range replaced by spaces, so offsets into it stay valid. */
export function blankRange(text: string, { start, end }: AgentReferenceTextRange): string {
    return `${text.slice(0, start)}${' '.repeat(end - start)}${text.slice(end)}`;
}
