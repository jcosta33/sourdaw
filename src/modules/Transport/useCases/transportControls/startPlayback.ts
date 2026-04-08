import { inject } from '#/infra/di/inject';
import { getTransportState, updateTransportState } from '#/modules/Transport/repositories/transport';
import { playheadPositionRef } from '#/modules/Transport/stores/playheadPositionRef';
import { resumeEngine } from '#/modules/AudioEngine/useCases/engineAccess';
import { startPlayheadScheduler } from '#/modules/Transport/useCases/playheadScheduler';
import { ensureTrackStrips } from '#/modules/Transport/useCases/ensureTrackStrips';

export const startPlayback = inject({ getTransportState, updateTransportState })(
    ({ getTransportState, updateTransportState }) =>
        function startPlayback(): void {
            const state = getTransportState();
            if (!state) {
                return;
            }

            resumeEngine();
            ensureTrackStrips();

            let startPosition = state.playheadPosition;
            if (state.preRollEnabled && state.preRollBars > 0) {
                const preRollBeats = state.preRollBars * state.timeSignatureNumerator;
                startPosition = Math.max(0, startPosition - preRollBeats);
            }

            updateTransportState({ isPlaying: true, playheadPosition: startPosition });
            playheadPositionRef.current = startPosition;
            startPlayheadScheduler();
        }
);
