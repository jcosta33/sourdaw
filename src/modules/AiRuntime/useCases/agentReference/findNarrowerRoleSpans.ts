import { type SemanticCommandListRoleFamily } from '../../models/SemanticCommandList';
import { CANONICAL_ROLE_OPTIONS, CANONICAL_ROLE_TO_RECIPE_ROLE } from '../canonicalRoleFamilies';

import { findAgentReferenceNameSpans, type AgentReferenceTextRange } from './findAgentReferenceNameSpans';
import { findNamedRoleFamilies } from './findNamedRoleFamilies';

/** The canonical roles whose phrase holds their family's own word in a longer phrase: "lead vocal". */
const NARROWER_ROLES = CANONICAL_ROLE_OPTIONS.filter((role) => {
    const family = CANONICAL_ROLE_TO_RECIPE_ROLE[role];
    return family !== null && role.includes(' ') && findNamedRoleFamilies(role, [family]).named.includes(family);
});

/** Where the text states a narrower role of one of the families, in either number: "the lead vocal". */
export function findNarrowerRoleSpans(
    text: string,
    families: readonly SemanticCommandListRoleFamily[]
): (AgentReferenceTextRange & { role: string })[] {
    return NARROWER_ROLES.filter((role) => {
        const family = CANONICAL_ROLE_TO_RECIPE_ROLE[role];
        return family !== null && families.includes(family);
    }).flatMap((role) =>
        findAgentReferenceNameSpans(text, role, 'with-number-forms', []).map((span) => ({ ...span, role }))
    );
}
