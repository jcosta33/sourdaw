import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { duplicateClipNotes } from '#/modules/MIDI/stores';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';

import { addClip } from './addClip';

export function duplicateClipCore(clipId: string, computeStartBeat: (clip: Clip) => number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    for (const track of state.tracks) {
        const clip = track.clips.find((context) => context.id === clipId);
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

                if (clip.type === 'midi') {
                    duplicateClipNotes(clipId, newClip.id);
                }
            }
            return;
        }
    }
}
