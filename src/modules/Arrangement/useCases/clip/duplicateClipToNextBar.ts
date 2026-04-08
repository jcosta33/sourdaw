import { inject } from '#/infra/di/inject';
import { getTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import { getTransportState } from '#/modules/Transport';
import { duplicateClipAutomation } from '#/modules/Automation';
import { addClip } from './addClip';

export const duplicateClipToNextBar = inject({ getTrackState })(
    ({ getTrackState }) =>
        function duplicateClipToNextBar(clipId: string): void {
            const state = getTrackState();
            if (!state) {
                return;
            }

            const transport = getTransportState();
            const beatsPerBar = transport?.timeSignatureNumerator ?? 4;

            for (const track of state.tracks) {
                const clip = track.clips.find((c) => c.id === clipId);
                if (clip) {
                    const duration = clip.endBeat - clip.startBeat;
                    const nextBarStart = Math.ceil(clip.endBeat / beatsPerBar) * beatsPerBar;
                    const newClip = addClip({
                        trackId: track.id,
                        startBeat: nextBarStart,
                        endBeat: nextBarStart + duration,
                        name: `${clip.name} (copy)`,
                        type: clip.type,
                        audioBufferId: clip.audioBufferId,
                    });

                    if (newClip) {
                        duplicateClipAutomation(clipId, newClip.id);
                    }
                    return;
                }
            }
        }
);
