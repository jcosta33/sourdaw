/**
 * Ripple editing use case.
 * Toggle ripple editing mode and provide ripple-aware clip deletion.
 *
 * When ripple editing is on, deleting a clip (or selection) automatically
 * shifts all subsequent clips left to fill the gap.
 */

import { workspaceStore } from '../stores/workspaceStore';
import { getTrackState, setTrackState } from '#/modules/Track/repositories/trackRepository';
import { type Clip } from '#/modules/Track/models/Track';

/**
 * Toggle ripple editing on/off.
 */
export function toggleRippleEditing(): void {
    const state = workspaceStore.value;
    if (!state) {
        return;
    }
    workspaceStore.set({ ...state, rippleEditing: !state.rippleEditing });
}

/**
 * Check if ripple editing is currently enabled.
 */
export function isRippleEditing(): boolean {
    return workspaceStore.value?.rippleEditing ?? false;
}

/**
 * Delete clips and optionally ripple-shift: moves all subsequent clips
 * on the same track left to fill the gap.
 *
 * @returns The removed clips and their original positions (for undo).
 */
export function rippleDeleteClips(
    trackId: string,
    clipIds: string[]
): {
    removedClips: Clip[];
    shiftedClips: Array<{ clipId: string; origStartBeat: number; origEndBeat: number }>;
} | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) {
        return null;
    }

    const idSet = new Set(clipIds);
    const removedClips = track.clips.filter((c) => idSet.has(c.id));

    if (removedClips.length === 0) {
        return null;
    }

    // Find the earliest start and latest end of deleted clips
    const deleteStart = Math.min(...removedClips.map((c) => c.startBeat));
    const deleteEnd = Math.max(...removedClips.map((c) => c.endBeat));
    const gap = deleteEnd - deleteStart;

    const ripple = workspaceStore.value?.rippleEditing ?? false;
    const shiftedClips: Array<{ clipId: string; origStartBeat: number; origEndBeat: number }> = [];

    const newClips = track.clips.reduce<Clip[]>((acc, clip) => {
        if (idSet.has(clip.id)) {
            return acc; // Remove deleted clips
        }
        if (ripple && clip.startBeat >= deleteEnd) {
            // Shift left to fill the gap
            shiftedClips.push({ clipId: clip.id, origStartBeat: clip.startBeat, origEndBeat: clip.endBeat });
            acc.push({
                ...clip,
                startBeat: clip.startBeat - gap,
                endBeat: clip.endBeat - gap,
            });
        } else {
            acc.push(clip);
        }
        return acc;
    }, []);

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, clips: newClips } : t)),
    });

    return { removedClips, shiftedClips };
}

/**
 * Undo a ripple delete: re-insert removed clips and shift back affected clips.
 */
export function undoRippleDelete(
    trackId: string,
    removedClips: Clip[],
    shiftedClips: Array<{ clipId: string; origStartBeat: number; origEndBeat: number }>
): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const shiftMap = new Map(shiftedClips.map((s) => [s.clipId, s]));

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) => {
            if (t.id !== trackId) {
                return t;
            }
            // Restore shifted clips to original positions
            const restored = t.clips.map((c) => {
                const orig = shiftMap.get(c.id);
                if (orig) {
                    return { ...c, startBeat: orig.origStartBeat, endBeat: orig.origEndBeat };
                }
                return c;
            });
            // Re-insert removed clips
            return { ...t, clips: [...restored, ...removedClips] };
        }),
    });
}
