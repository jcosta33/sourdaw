import { getTrackState } from '#/modules/Arrangement/repositories/track';
import { duplicateClipAutomation } from '#/modules/Automation/useCases/automation';
import { addClip } from './addClip';

export function duplicateClip(clipId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            const duration = clip.endBeat - clip.startBeat;
            const newClip = addClip({
                trackId: track.id,
                startBeat: clip.endBeat,
                endBeat: clip.endBeat + duration,
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
