import { getTrackState } from '../../repositories/track/getTrackState';
import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { batchAddMidiNotes, getNotesForClip } from '#/modules/MIDI/useCases';
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

                // MIDI notes are stored with absolute `startBeat` keyed by clip id.
                // Duplicating the clip without cloning its notes silently drops
                // all MIDI content — shift each note by the clip delta and
                // re-insert under the new clip id.
                if (clip.type === 'midi') {
                    const sourceNotes = getNotesForClip(clipId);
                    if (sourceNotes.length > 0) {
                        const beatDelta = startBeat - clip.startBeat;
                        batchAddMidiNotes(
                            newClip.id,
                            sourceNotes.map((note) => ({
                                pitch: note.pitch,
                                startBeat: note.startBeat + beatDelta,
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
