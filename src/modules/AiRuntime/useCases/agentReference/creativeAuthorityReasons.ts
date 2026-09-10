import { type CreativeRequestAuthority } from '../../models/CreativeInterpretation';

/**
 * Every refusal the creative route states names the authority, because on that route the authority
 * is the whole reason the call was considered at all: the request carries no vocabulary that could
 * have justified it.
 */
export const CREATIVE_AUTHORITY_REASON_PREFIX = 'Creative authority';

type CreationSlotObjectType = CreativeRequestAuthority['creationSlots'][number]['objectType'];

/**
 * What a batch is told when it asks for one more object than the slot it spends published. The
 * creative admission and the grounding bridge both bound creations by that published slot, so they
 * say so in one wording rather than in two that could drift apart.
 */
export function getSpentCreationBudgetReason(objectType: CreationSlotObjectType, budget: number): string {
    return `${CREATIVE_AUTHORITY_REASON_PREFIX} has spent its ${objectType} creation budget of ${String(budget)}`;
}
