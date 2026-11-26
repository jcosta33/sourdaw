import { type Range, type Slot } from './readProtectionSlots';

export type SelectionMember = {
    phrase: string;
    scope: 'any' | 'track';
    controls: string[];
    pronoun: boolean;
    anaphoric: boolean;
};
/** `byName` is false for a role family, which names its tracks by role rather than by track name. */
export type BoundMember = { trackIds: string[]; controls: string[]; byName: boolean };
/** What the protection reader read from one slot's members. */
export type SlotReading = {
    complete: boolean;
    uniqueTrackOwners: boolean;
    /** Project references the slot states that name no track: a device, section, marker, lane or parameter. */
    nonTrackReferences: Range[];
    unreadContinuations: Range[];
    unresolved: string[];
    selection: SelectionMember[];
    bound: BoundMember[];
    /** Controls the slot lists with no owner ("except for the fader"). */
    controls: string[];
};

/**
 * Whether a clause a protection verb opens (never a prohibition or a carve-out) states members and the
 * protection reader read nothing from them ("keep the Kick level punchy"): no member binds a track,
 * names an unbound object form, points at the selection or lists a control, no text is left unread
 * as a continuation, and every project reference it states names a track or a VCA group of tracks.
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
