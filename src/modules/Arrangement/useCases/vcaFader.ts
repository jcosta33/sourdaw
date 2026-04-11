import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';

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
