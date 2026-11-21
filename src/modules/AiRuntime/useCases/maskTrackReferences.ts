import { type ProjectContext } from '../models/ProjectContext';
import { maskQuotedTextContents } from '../transformers/promptParser/promptQuotedText';

import {
    type AgentReferenceNameSpan,
    type AgentReferenceTextRange,
    findAgentReferenceNameSpans,
} from './agentReference/findAgentReferenceNameSpans';
import { readProjectObjectNames } from './projectObjectNameCensus';

/** The closing bracket a name ends in, after the bracket it closes: the ")" of "Bass (DI)". */
const NAME_CLOSING_BRACKET = /(?:\([^()[\]]*(\))|\[[^()[\]]*(\]))$/u;

/**
 * A name's range with the closing bracket the name itself opened and closes, where the text types the
 * name as it is written and that bracket right after the range: a name's reading stops short of its
 * closing bracket, but that bracket is still the name's own, so "Bass (DI)" is blanked whole and leaves
 * no bracket of its own behind, while "Bass DI)" read as Bass (DI) leaves its bracket standing. Other
 * closing punctuation ("Lead.", "Pad?", "Keys)") is left to the text, where it may end a sentence or a
 * bracket the text opened.
 */
function withNameClosing(text: string, name: string, span: AgentReferenceNameSpan): AgentReferenceTextRange {
    const bracket = NAME_CLOSING_BRACKET.exec(name.trim());
    const closing = bracket?.[1] ?? bracket?.[2];
    if (span.closeness !== 'typed' || closing === undefined || !text.startsWith(closing, span.end)) {
        return span;
    }
    return { start: span.start, end: span.end + closing.length };
}

/**
 * The prompt with quoted text and every name and literal id of an object the request can cite blanked
 * (a track, clip, device, section, marker, VCA group or adjustment layer, as the census reads them),
 * offsets kept, so a word inside a name ("Bright Keys", "Dark Bridge") or a quotation is never read as
 * the request's own. `fill` is the character each blanked position takes: a space drops the reference
 * from the sentence, a non-space keeps it standing as one word a clause can still hold as its object.
 */
export function maskTrackReferences(prompt: string, context: ProjectContext, fill: string): string {
    const names = readProjectObjectNames(context);
    const original = maskQuotedTextContents(prompt);
    const spans = names.flatMap((name) =>
        findAgentReferenceNameSpans(original, name, 'exact', names).map((span) => withNameClosing(original, name, span))
    );
    const masked = original.split('');
    for (const span of spans) {
        for (let index = span.start; index < span.end; index += 1) {
            masked[index] = fill;
        }
    }
    return masked.join('');
}
