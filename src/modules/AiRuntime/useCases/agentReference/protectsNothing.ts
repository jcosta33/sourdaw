import { type Slot } from './readProtectionSlots';
import { type SlotReading } from './SlotReading';

/**
 * Whether a clause a protection verb opens (never a prohibition or a carve-out) states members and the
 * protection reader read nothing from them ("keep the Kick level punchy"): no member binds a track,
 * names an unbound object form, points at the selection or lists a control, no text is left unread
 * as a continuation, and every project reference it states names a track or a VCA group with members.
 */
export function protectsNothing(
    slot: Slot,
    masked: string,
    members: Pick<
        SlotReading,
        'unresolved' | 'bound' | 'selection' | 'controls' | 'unreadContinuations' | 'nonTrackReferences'
    >
): boolean {
    const { unresolved, bound, selection, controls, unreadContinuations, nonTrackReferences } = members;
    const stated = masked.slice(slot.start, slot.end).trim() !== '';
    const lists = [unresolved, bound, selection, controls, unreadContinuations, nonTrackReferences];
    return slot.lead === 'verb' && stated && lists.every((list) => list.length === 0);
}
