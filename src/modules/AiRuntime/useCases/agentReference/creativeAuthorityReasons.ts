import { type CreativeRequestAuthority } from '../../models/CreativeInterpretation';

/**
 * Every refusal the creative route states names the authority, because on that route the authority
 * is the whole reason the call was considered at all: the request carries no vocabulary that could
 * have justified it.
 */
export const CREATIVE_AUTHORITY_REASON_PREFIX = 'Creative authority';

type CreationSlotObjectType = CreativeRequestAuthority['creationSlots'][number]['objectType'];

/**
 * The two fixed halves of the spent-budget statement, around the object type and the budget the
 * statement names. A reader recognising that statement matches on these rather than on a second copy
 * of the wording, so the reason a route writes and the reason a route recognises cannot drift apart.
 */
export const SPENT_CREATION_BUDGET_PREFIX = `${CREATIVE_AUTHORITY_REASON_PREFIX} has spent its`;
export const SPENT_CREATION_BUDGET_INFIX = 'creation budget of';

/**
 * What a batch is told when it asks for one more object than the slot it spends published. The
 * creative admission and the grounding bridge both bound creations by that published slot, so they
 * say so in one wording rather than in two that could drift apart.
 */
export function getSpentCreationBudgetReason(objectType: CreationSlotObjectType, budget: number): string {
    return `${SPENT_CREATION_BUDGET_PREFIX} ${objectType} ${SPENT_CREATION_BUDGET_INFIX} ${String(budget)}`;
}
