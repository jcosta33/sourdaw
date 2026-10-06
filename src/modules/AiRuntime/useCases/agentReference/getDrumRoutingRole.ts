import { type DrumRoutingRole } from '../../models/DrumRoutingCapability';

const DRUM_ROUTING_ROLE_BY_CANONICAL_ROLE: ReadonlyMap<string, DrumRoutingRole> = new Map([
    ['kick', 'kick'],
    ['snare', 'snare'],
    ['hi-hat', 'hi-hat'],
    ['tom', 'tom'],
    ['cymbal', 'cymbal'],
    ['percussion', 'percussion'],
    ['overhead', 'overhead'],
    ['room', 'room'],
    ['drums', 'drums'],
]);

/**
 * The drum workflows' role for a canonical track role, or null when the canonical role is not in
 * the drums family. This is the single translation from Project's one track-role classifier into
 * the drum workflows' vocabulary.
 */
export function getDrumRoutingRole(canonicalRole: string): DrumRoutingRole | null {
    return DRUM_ROUTING_ROLE_BY_CANONICAL_ROLE.get(canonicalRole) ?? null;
}
