import { type ProjectContext } from '../models/ProjectContext';
import { maskQuotedTextContents } from '../transformers/promptParser/promptQuotedText';

import { findAgentReferenceNameSpans } from './agentReference/findAgentReferenceNameSpans';
import { readProjectObjectNames } from './projectObjectNameCensus';

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
    const spans = names.flatMap((name) => findAgentReferenceNameSpans(original, name, 'exact', names));
    const masked = original.split('');
    for (const span of spans) {
        for (let index = span.start; index < span.end; index += 1) {
            masked[index] = fill;
        }
    }
    return masked.join('');
}
