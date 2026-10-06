import { downloadMidiFile, getMidiStoreState, projectMidiClipWindow } from '#/modules/MIDI/useCases';

import { getAllTracks } from './getAllTracks';

export function exportMidiClip(clipId: string): void {
    const tracks = getAllTracks();
    const midi = getMidiStoreState();
    if (tracks.length === 0 || !midi) {
        return;
    }

    let clipName = 'export';
    let clipStartBeat = 0;
    let midiOffsetBeats = 0;
    let visibleBeats = Number.POSITIVE_INFINITY;
    for (const track of tracks) {
        const clip = track.clips.find((candidateClip) => candidateClip.id === clipId);
        if (clip) {
            clipName = clip.name || track.name;
            clipStartBeat = clip.startBeat;
            midiOffsetBeats = clip.midiOffsetBeats ?? 0;
            visibleBeats = clip.endBeat - clip.startBeat;
            break;
        }
    }

    // The file holds what the clip plays for one pass: the visible window of the
    // content, slipped by the offset so the window's first beat lands on the clip start.
    const { notes, controlChanges } = projectMidiClipWindow({
        notes: midi.notesByClipId[clipId] ?? [],
        controlChanges: midi.ccByClipId[clipId] ?? [],
        pitchBends: midi.pitchBendByClipId[clipId] ?? [],
        window: {
            beatOffset: -midiOffsetBeats,
            visibleStartBeat: midiOffsetBeats,
            visibleEndBeat: midiOffsetBeats + visibleBeats,
        },
    });

    downloadMidiFile({ clipName, clipStartBeat, notes, ccs: controlChanges });
}
