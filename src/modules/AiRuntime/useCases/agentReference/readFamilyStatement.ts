import { type SemanticCommandListRoleFamily } from '../../models/SemanticCommandList';

import { blankRange } from './blankRange';
import { findNamedRoleFamilies } from './findNamedRoleFamilies';
import { findNarrowerRoleSpans } from './findNarrowerRoleSpans';

/**
 * How the instruction states a family: by its own word outside every narrower role phrase, heading
 * its phrase or modifying the next word ("the vocals", "the drum tracks", "the drum kit"); only
 * through narrower roles holding its word ("turn down the lead vocal" states the lead vocal, never
 * every vocal); not at all while another part of the request states it ("set Keys volume to 75% and
 * mute the drums"); or in no word the family reading knows ("the vox"), which leaves the family as
 * the compiler resolved it.
 */
export type FamilyStatement =
    { kind: 'family' } | { kind: 'roles'; roles: ReadonlySet<string> } | { kind: 'elsewhere' } | { kind: 'unread' };

function readStatedFamily(masked: string, family: SemanticCommandListRoleFamily): FamilyStatement | undefined {
    const roleSpans = findNarrowerRoleSpans(masked, [family]);
    const uses = findNamedRoleFamilies(roleSpans.reduce(blankRange, masked), [family]);
    if ([...uses.named, ...uses.modifying].includes(family)) {
        return { kind: 'family' };
    }
    if (roleSpans.length === 0) {
        return undefined;
    }
    return { kind: 'roles', roles: new Set(roleSpans.map((span) => span.role)) };
}

/** How the instruction states the family, read from its scoped text and the whole request, object names masked. */
export function readFamilyStatement(
    masked: { scoped: string; whole: string },
    family: SemanticCommandListRoleFamily
): FamilyStatement {
    const statement = readStatedFamily(masked.scoped, family);
    if (statement !== undefined) {
        return statement;
    }
    return readStatedFamily(masked.whole, family) === undefined ? { kind: 'unread' } : { kind: 'elsewhere' };
}
