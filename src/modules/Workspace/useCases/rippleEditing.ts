/**
 * Ripple editing use case.
 * Toggle ripple editing mode and provide ripple-aware clip deletion.
 *
 * When ripple editing is on, deleting a clip (or selection) automatically
 * shifts all subsequent clips left to fill the gap.
 */

import { inject } from '#/infra/di/inject';
import { workspaceStore } from '../stores/workspaceStore';
import { getTrackStoreState, setTrackState } from '#/modules/Arrangement';
import { type Clip } from '../models/TrackViewTypes';

export const toggleRippleEditing = inject({ workspaceStore })(
    ({ workspaceStore }) =>
        function toggleRippleEditing(): void {
            const state = workspaceStore.value;
            if (!state) {
                return;
            }
            workspaceStore.set({ ...state, rippleEditing: !state.rippleEditing });
        }
);

export type RippleDeletePlan = {
    removedClips: Clip[];
    shiftedClips: Array<{ clipId: string; origStartBeat: number; origEndBeat: number }>;
    nextClips: Clip[];
};

export const planRippleDelete = inject({ getTrackStoreState, workspaceStore })(
    ({ getTrackStoreState, workspaceStore }) =>
        function planRippleDelete(trackId: string, clipIds: string[]): RippleDeletePlan | null {
            const state = getTrackStoreState();
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

            const deleteStart = Math.min(...removedClips.map((c) => c.startBeat));
            const deleteEnd = Math.max(...removedClips.map((c) => c.endBeat));
            const gap = deleteEnd - deleteStart;

            const ripple = workspaceStore.value?.rippleEditing ?? false;
            const shiftedClips: Array<{ clipId: string; origStartBeat: number; origEndBeat: number }> = [];

            const nextClips = track.clips.reduce<Clip[]>((acc, clip) => {
                if (idSet.has(clip.id)) {
                    return acc;
                }
                if (ripple && clip.startBeat >= deleteEnd) {
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

            return { removedClips, shiftedClips, nextClips };
        }
);

export const rippleDeleteClips = inject({ getTrackStoreState, setTrackState, planRippleDelete })(
    ({ getTrackStoreState, setTrackState, planRippleDelete }) =>
        function rippleDeleteClips(
            trackId: string,
            clipIds: string[]
        ): {
            removedClips: Clip[];
            shiftedClips: Array<{ clipId: string; origStartBeat: number; origEndBeat: number }>;
        } | null {
            const plan = planRippleDelete(trackId, clipIds);
            if (!plan) {
                return null;
            }

            const state = getTrackStoreState();
            if (!state) {
                return null;
            }

            setTrackState({
                ...state,
                tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, clips: plan.nextClips } : t)),
            });

            return { removedClips: plan.removedClips, shiftedClips: plan.shiftedClips };
        }
);

export const undoRippleDelete = inject({ getTrackStoreState, setTrackState })(
    ({ getTrackStoreState, setTrackState }) =>
        function undoRippleDelete(
            trackId: string,
            removedClips: Clip[],
            shiftedClips: Array<{ clipId: string; origStartBeat: number; origEndBeat: number }>
        ): void {
            const state = getTrackStoreState();
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
);
