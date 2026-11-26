import { type ProjectContextTrack } from '../../models/ProjectContext';
import { SEMANTIC_COMMAND_LIST_ROLE_FAMILIES } from '../../models/SemanticCommandList';

import { findAgentReferenceNameSpans } from './findAgentReferenceNameSpans';
import { findNamedRoleFamilies } from './findNamedRoleFamilies';
import { listWordStartFragments } from './listWordStartFragments';
import { PHRASED_ROLES } from './phrasedRoles';

function statesPhrase(masked: string, phrase: string): boolean {
    return findAgentReferenceNameSpans(masked, phrase, 'with-number-forms', []).length > 0;
}

/** Whether a family word heads its phrase or modifies the next word: "the drums", "the drum tracks". */
function statesRoleFamily(masked: string): boolean {
    const uses = findNamedRoleFamilies(masked, SEMANTIC_COMMAND_LIST_ROLE_FAMILIES);
    return uses.named.length > 0 || uses.modifying.length > 0;
}

/**
 * Whether text with every object name masked states tracks in a form a selector reads beside whole
 * names, in either number: a canonical role phrase ("the lead vocal"), a role family word ("the
 * drums", "the drum tracks") or a fragment one of the tracks' names holds at a word start ("the pad" for Synth Pad).
 */
export function namesTrackSelectorForm(masked: string, tracks: readonly ProjectContextTrack[]): boolean {
    return (
        PHRASED_ROLES.some((role) => statesPhrase(masked, role)) ||
        statesRoleFamily(masked) ||
        tracks.some((track) => listWordStartFragments(track.name).some((fragment) => statesPhrase(masked, fragment)))
    );
}
