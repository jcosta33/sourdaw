/**
 * VCA Fader use cases.
 * VCA (Voltage-Controlled Amplifier) groups allow a single fader to
 * control the gain of multiple tracks without summing their audio.
 *
 * Unlike bus/folder summing, VCA tracks:
 * - Don't route audio through themselves
 * - Scale the gain of assigned tracks multiplicatively
 * - Preserve each track's sends, aux levels, and fader post values
 *
 * The Track model already has `vcaGroupId: string | null`.
 */

import { getTrackState, setTrackState } from '../repositories/trackRepository';

export type VCAGroup = {
    id: string;
    name: string;
    gain: number; // 0-1, multiplied against target track gains
};

// In-memory VCA group store
const vcaGroups = new Map<string, VCAGroup>();

/**
 * Create a new VCA group.
 */
export function createVCAGroup(name: string): VCAGroup {
    const group: VCAGroup = {
        id: `vca-${crypto.randomUUID().slice(0, 8)}`,
        name,
        gain: 1.0,
    };
    vcaGroups.set(group.id, group);
    return group;
}

/**
 * Assign a track to a VCA group.
 */
export function assignTrackToVCA(trackId: string, vcaGroupId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, vcaGroupId } : t)),
    });
}

/**
 * Remove a track from its VCA group.
 */
export function removeTrackFromVCA(trackId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, vcaGroupId: null } : t)),
    });
}

/**
 * Get all VCA groups.
 */
export function getAllVCAGroups(): VCAGroup[] {
    return [...vcaGroups.values()];
}
