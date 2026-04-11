import { inject } from '#/infra/di/inject';
import { punchRecordingStore, type PunchRegion } from '#/modules/Transport/stores/punchRecordingStore';
import { getNextPunchId } from '../../repositories/punchRecordingIdCounter';

export const definePunchRegion = inject({ punchRecordingStore, getNextPunchId })(
    ({ punchRecordingStore: store, getNextPunchId: nextId }) => {
        return function definePunchRegion(captureId: string, punchInBeat: number, punchOutBeat: number): void {
            const state = store.value;
            if (!state) {
                return;
            }

            const capture = state.captures.find((c) => c.id === captureId);
            if (!capture) {
                return;
            }

            const region: PunchRegion = {
                id: nextId(),
                trackId: capture.trackId,
                punchInBeat,
                punchOutBeat,
                sourceClipId: capture.id,
                preRollBeats: state.defaultPreRoll,
                postRollBeats: state.defaultPostRoll,
                committed: false,
                crossfadeBeats: state.defaultCrossfade,
            };

            store.set({
                ...state,
                captures: state.captures.map((c) =>
                    c.id === captureId ? { ...c, punchRegions: [...c.punchRegions, region] } : c
                ),
            });
        };
    }
);
