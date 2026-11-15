import { normalizeAgentReferenceText } from './normalizeAgentReferenceText';
import { readRoleFamilyWords } from './roleFamilyWords';

/**
 * The role families a text names as whole words, in the order `roles` lists them. The caller masks
 * what must not count first (track names, quoted text, protection clauses), since a word inside a name
 * such as "Drum Bus" names that track and not the family.
 */
export function findNamedRoleFamilies<TRole extends string>(text: string, roles: readonly TRole[]): TRole[] {
    const words = ` ${normalizeAgentReferenceText(text)} `;
    return roles.filter((role) => readRoleFamilyWords(role).some((word) => words.includes(` ${word} `)));
}
