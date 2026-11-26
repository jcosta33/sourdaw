import { type Slot } from './readProtectionSlots';

/** What the protection reader read from a clause's members. */
type MemberLists = Record<
    'unresolved' | 'bound' | 'selection' | 'controls' | 'unreadContinuations',
    readonly unknown[]
>;

/**
 * Whether a clause a protection verb opens states members and the protection reader read nothing from
 * them: nothing binds, names an object form, points at the selection or lists a control ("keep the Kick
 * level punchy").
 */
export function protectsNothing(slot: Slot, masked: string, members: MemberLists): boolean {
    const { unresolved, bound, selection, controls, unreadContinuations } = members;
    const stated = masked.slice(slot.start, slot.end).trim() !== '';
    const lists = [unresolved, bound, selection, controls, unreadContinuations];
    return slot.lead === 'verb' && !slot.exempts && stated && lists.every((list) => list.length === 0);
}
