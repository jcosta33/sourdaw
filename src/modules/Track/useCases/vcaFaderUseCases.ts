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
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, vcaGroupId } : t
        ),
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
        tracks: state.tracks.map((t) =>
            t.id === trackId ? { ...t, vcaGroupId: null } : t
        ),
    });
}

/**
 * Set the gain of a VCA group.
 * This scales the gain of all tracks assigned to this group.
 */
export function setVCAGroupGain(vcaGroupId: string, gain: number): void {
    const group = vcaGroups.get(vcaGroupId);
    if (!group) {
        return;
    }
    group.gain = Math.max(0, Math.min(1.5, gain));
    vcaGroups.set(vcaGroupId, group);
}

/**
 * Get the effective gain for a track (track gain × VCA gain).
 */
export function getEffectiveGain(trackId: string): number {
    const state = getTrackState();
    if (!state) {
        return 1.0;
    }
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
        return 1.0;
    }

    if (!track.vcaGroupId) {
        return track.gain;
    }

    const group = vcaGroups.get(track.vcaGroupId);
    if (!group) {
        return track.gain;
    }

    return track.gain * group.gain;
}

/**
 * Get all VCA groups.
 */
export function getAllVCAGroups(): VCAGroup[] {
    return [...vcaGroups.values()];
}

/**
 * Delete a VCA group and unassign all tracks.
 */
export function deleteVCAGroup(vcaGroupId: string): void {
    vcaGroups.delete(vcaGroupId);

    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) =>
            t.vcaGroupId === vcaGroupId ? { ...t, vcaGroupId: null } : t
        ),
    });
}

/**
 * Get tracks assigned to a VCA group.
 */
export function getVCAGroupTracks(vcaGroupId: string): string[] {
    const state = getTrackState();
    if (!state) {
        return [];
    }
    return state.tracks
        .filter((t) => t.vcaGroupId === vcaGroupId)
        .map((t) => t.id);
}
