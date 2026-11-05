import { type ProjectContext } from '../models/ProjectContext';
import { maskQuotedTextContents } from '../transformers/promptParser/promptQuotedText';

import { findAgentReferenceNameSpans } from './agentReference/findAgentReferenceNameSpans';

/**
 * The prompt with quoted text and every track name and literal track id blanked, offsets kept, so a
 * word inside a name ("Bright Keys", "Warm Pad") or a quotation is never read as the request's own.
 * `fill` is the character each blanked position takes: a space drops the reference from the
 * sentence, a non-space keeps it standing as one word a clause can still hold as its object.
 */
export function maskTrackReferences(prompt: string, context: ProjectContext, fill: string): string {
    const names = context.tracks.flatMap((track) => [track.name, track.id]);
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
