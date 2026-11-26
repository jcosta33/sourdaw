import { CANONICAL_ROLE_OPTIONS, CANONICAL_ROLE_TO_RECIPE_ROLE } from '../canonicalRoleFamilies';

/**
 * The canonical roles a request names by their own phrase rather than by their family's word, which
 * the family reading takes: "the backing vocals", "the kick", never "the drums". The bus and master
 * roles are their own family's word, so none is phrased.
 */
export const PHRASED_ROLES = CANONICAL_ROLE_OPTIONS.filter((role) => {
    const family = CANONICAL_ROLE_TO_RECIPE_ROLE[role];
    return family !== null && role !== family;
});
