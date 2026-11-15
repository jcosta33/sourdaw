import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';

/** The words a request names one role family by, singular and plural ("drum", "drums"; "bass", "basses"). */
export function readRoleFamilyWords(role: string): string[] {
    if (role === 'bass') {
        return ['bass', 'basses'];
    }
    if (role === 'bus') {
        return ['bus', 'buses'];
    }
    const singular = role.endsWith('s') ? role.slice(0, -1) : role;
    return [singular, `${singular}s`];
}

/**
 * The role families a text names as whole words, in the order `roles` lists them. The caller masks
 * what must not count first (track names, quoted text, protection clauses), since a word inside a name
 * such as "Drum Bus" names that track and not the family.
 */
export function findNamedRoleFamilies<TRole extends string>(text: string, roles: readonly TRole[]): TRole[] {
    const words = ` ${normalizeAgentReferenceText(text)} `;
    return roles.filter((role) => readRoleFamilyWords(role).some((word) => words.includes(` ${word} `)));
}
