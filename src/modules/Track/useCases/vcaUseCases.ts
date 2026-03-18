/**
 * VCA Fader / DCA Group use cases.
 * A VCA group multiplies a master gain/mute on top of each assigned track's own gain.
 *
 * All store access goes through the Track repository.
 */

import { getTrackById, updateTrack, updateTracks } from '../repositories/trackRepository';

export type VcaGroup = {
    id: string;
    name: string;
    gain: number;
    muted: boolean;
    trackIds: string[];
};

let vcaGroups: VcaGroup[] = [];

export function getVcaGroups(): VcaGroup[] {
    return [...vcaGroups];
}

export function createVcaGroup(name: string, trackIds: string[]): VcaGroup {
    const group: VcaGroup = {
        id: `vca-${crypto.randomUUID().slice(0, 8)}`,
        name,
        gain: 1.0,
        muted: false,
        trackIds: [...trackIds],
    };
    vcaGroups = [...vcaGroups, group];

    // Assign the group to each track via repository
    updateTracks(
        (t) => trackIds.includes(t.id),
        (t) => ({ ...t, vcaGroupId: group.id })
    );

    return group;
}

export function assignToVca(trackId: string, vcaGroupId: string): void {
    const group = vcaGroups.find((g) => g.id === vcaGroupId);
    if (!group) {
        return;
    }

    if (!group.trackIds.includes(trackId)) {
        group.trackIds.push(trackId);
    }

    updateTrack(trackId, (t) => ({ ...t, vcaGroupId }));
}

export function removeFromVca(trackId: string): void {
    for (const group of vcaGroups) {
        group.trackIds = group.trackIds.filter((id) => id !== trackId);
    }

    updateTrack(trackId, (t) => ({ ...t, vcaGroupId: null }));
}

export function setVcaGain(vcaGroupId: string, gain: number): void {
    const group = vcaGroups.find((g) => g.id === vcaGroupId);
    if (!group) {
        return;
    }
    group.gain = Math.max(0, Math.min(2, gain));
}

/**
 * Get the effective gain for a track, multiplied by its VCA group gain.
 */
export function getEffectiveGain(trackId: string, trackGain: number): number {
    const track = getTrackById(trackId);
    if (!track?.vcaGroupId) {
        return trackGain;
    }

    const group = vcaGroups.find((g) => g.id === track.vcaGroupId);
    if (!group) {
        return trackGain;
    }

    return trackGain * group.gain;
}
