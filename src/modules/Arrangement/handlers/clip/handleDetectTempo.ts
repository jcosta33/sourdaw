import { inject } from '#/infra/di/inject';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { createHandler } from '#/helpers/createHandler';
import { type AppAction } from '#/modules/Command';
import { detectTempo as detectTempoFromBuffer } from '#/modules/AudioAnalysis';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { detectProjectTempo } from '#/modules/Transport';
import type { ExtractAction } from '../types';

export const executeDetectTempo = inject({
    getTrackStoreState,
    detectTempoFromBuffer,
    detectProjectTempo,
    notifyUser,
})(
    ({ getTrackStoreState, detectTempoFromBuffer, detectProjectTempo, notifyUser }) =>
        function executeDetectTempo(a: ExtractAction<AppAction, 'detectTempo'>): void {
            const clip = getTrackStoreState()
                ?.tracks.flatMap((t) => t.clips)
                .find((c) => c.id === a.payload.clipId);
            if (clip?.audioBufferId) {
                const bpm = detectTempoFromBuffer(clip.audioBufferId);
                if (bpm) {
                    notifyUser(`Detected tempo: ${bpm} BPM`);
                } else {
                    notifyUser('Could not detect tempo');
                }
                return;
            }
            const result = detectProjectTempo();
            notifyUser(
                result.confidence > 0.5
                    ? `Detected tempo: ${result.averageBpm} BPM (${result.minBpm}–${result.maxBpm} range)`
                    : 'Could not confidently detect tempo — add more content first',
                result.confidence > 0.5 ? 'success' : 'warning'
            );
        }
);

export const handleDetectTempo = createHandler<'detectTempo'>({
    execute: executeDetectTempo,
    describe: () => ({ label: 'Detect tempo' }),
    undoable: true,
});
