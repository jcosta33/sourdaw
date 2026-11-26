import { type Range } from './readProtectionSlots';

/** A member that points at the selection ("it", "the selected track"). */
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
    /**
     * Project references the slot states that name something other than tracks and VCA groups with
     * members: a clip, device, section, marker, lane or parameter.
     */
    nonTrackReferences: Range[];
    unreadContinuations: Range[];
    unresolved: string[];
    selection: SelectionMember[];
    bound: BoundMember[];
    /** Controls the slot lists with no owner ("except for the fader"). */
    controls: string[];
};
