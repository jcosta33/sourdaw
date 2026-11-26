import { type ProjectContextTrack } from '../../models/ProjectContext';
import { SEMANTIC_COMMAND_LIST_ROLE_FAMILIES } from '../../models/SemanticCommandList';

import { findAgentReferenceNameSpans } from './findAgentReferenceNameSpans';
import { findNamedRoleFamilies } from './findNamedRoleFamilies';
import { listWordStartFragments } from './listWordStartFragments';
import { PHRASED_ROLES } from './phrasedRoles';
import { refinementRequestReading } from './refinementRequestReading';

function statesPhrase(masked: string, phrase: string): boolean {
    return findAgentReferenceNameSpans(masked, phrase, 'with-number-forms', []).length > 0;
}

/**
 * A fragment the request's ordinary language shares states no track: a single letter, or an article
 * ("a" of Synth A in "add a compressor").
 */
function isStopWordFragment(fragment: string): boolean {
    return fragment.length === 1 || refinementRequestReading.articles.includes(fragment);
}

function statesTrackFragment(masked: string, track: ProjectContextTrack): boolean {
    return listWordStartFragments(track.name).some(
        (fragment) => !isStopWordFragment(fragment) && statesPhrase(masked, fragment)
    );
}

/** Whether a family word heads its phrase or modifies the next word: "the drums", "the drum tracks". */
function statesRoleFamily(masked: string): boolean {
    const uses = findNamedRoleFamilies(masked, SEMANTIC_COMMAND_LIST_ROLE_FAMILIES);
    return uses.named.length > 0 || uses.modifying.length > 0;
}

/**
 * Whether text with every object name masked states tracks in a form a selector reads beside whole
 * names, in either number: a canonical role phrase ("the lead vocal"), a role family word ("the
 * drums", "the drum tracks") or a fragment, other than a stop word, one of the tracks' names holds at a
 * word start ("the pad" for Synth Pad).
 */
export function namesTrackSelectorForm(masked: string, tracks: readonly ProjectContextTrack[]): boolean {
    return (
        PHRASED_ROLES.some((role) => statesPhrase(masked, role)) ||
        statesRoleFamily(masked) ||
        tracks.some((track) => statesTrackFragment(masked, track))
    );
}
