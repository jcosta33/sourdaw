import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { batchAddMidiNotes, getNotesForClip } from '#/modules/MIDI/useCases';

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

                // MIDI notes are stored with clip-relative `startBeat` keyed by clip id.
                // Duplicating the clip without cloning its notes silently drops
                // all MIDI content. Re-insert under the new clip id.
                if (clip.type === 'midi') {
                    const sourceNotes = getNotesForClip(clipId);
                    if (sourceNotes.length > 0) {
                        batchAddMidiNotes(
                            newClip.id,
                            sourceNotes.map((note) => ({
                                pitch: note.pitch,
                                startBeat: note.startBeat,
                                duration: note.duration,
                                velocity: note.velocity,
                            }))
                        );
                    }
                }
            }
            return;
        }
    }
}
