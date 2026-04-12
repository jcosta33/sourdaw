import { getTrackState } from '../../repositories/track/getTrackState';
import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { addClip } from './addClip';
import { type Clip } from '../../models/Track';

export function duplicateClipCore(clipId: string, computeStartBeat: (clip: Clip) => number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            const duration = clip.endBeat - clip.startBeat;
            const startBeat = computeStartBeat(clip);
            const newClip = addClip({
                trackId: track.id,
                startBeat,
                endBeat: startBeat + duration,
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
