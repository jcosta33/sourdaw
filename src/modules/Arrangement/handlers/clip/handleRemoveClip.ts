import { inject } from '#/infra/di/inject';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { removeClip } from '../../useCases/clip/removeClip';
import { midiStore } from '#/modules/MIDI';
import { planRippleDelete, rippleDeleteClips } from '#/modules/Workspace';
import type { ExtractAction } from '../types';

export const executeRemoveClip = inject({ getTrackStoreState, rippleDeleteClips, removeClip })(
    ({ getTrackStoreState, rippleDeleteClips, removeClip }) =>
        function executeRemoveClip(a: ExtractAction<AppAction, 'removeClip'>): void {
            const state = getTrackStoreState();
            let trackId: string | null = null;
            if (state) {
                for (const track of state.tracks) {
                    if (track.clips.some((c) => c.id === a.payload.clipId)) {
                        trackId = track.id;
                        break;
                    }
                }
            }
            if (!trackId) {
                removeClip(a.payload.clipId);
                return;
            }
            const rippleResult = rippleDeleteClips(trackId, [a.payload.clipId]);
            if (!rippleResult) {
                removeClip(a.payload.clipId);
            }
        }
);

export const handleRemoveClip = createHandler<'removeClip'>({
    execute: executeRemoveClip,
    describe: (a) => {
        const state = getTrackStoreState();
        let clipSnapshot: unknown = null;
        let trackId: string | null = null;
        if (state) {
            for (const track of state.tracks) {
                const clip = track.clips.find((c) => c.id === a.payload.clipId);
                if (clip) {
                    clipSnapshot = structuredClone(clip);
                    trackId = track.id;
                    break;
                }
            }
        }
        if (!clipSnapshot || !trackId) {
            return { label: 'Remove clip' };
        }

        const plan = planRippleDelete(trackId, [a.payload.clipId]);
        const ripplePlan = plan
            ? {
                  removedClips: structuredClone(plan.removedClips) as unknown[],
                  shiftedClips: structuredClone(plan.shiftedClips) as unknown[],
              }
            : null;

        const midiState = midiStore.value;
        const notes = midiState?.notesByClipId[a.payload.clipId];
        const cc = midiState?.ccByClipId[a.payload.clipId];
        const pb = midiState?.pitchBendByClipId[a.payload.clipId];

        return {
            label: 'Remove clip',
            inverseAction: {
                type: 'restoreClip',
                payload: {
                    clipId: a.payload.clipId,
                    trackId,
                    clipSnapshot,
                    ripplePlan,
                    midiNotesSnapshot: notes ? structuredClone(notes) : null,
                    midiCcSnapshot: cc ? structuredClone(cc) : null,
                    midiPitchBendSnapshot: pb ? structuredClone(pb) : null,
                },
            },
        };
    },
    undoable: true,
});
