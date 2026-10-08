import { downloadMidiFile, getMidiStoreState, projectMidiClipPlayback } from '#/modules/MIDI/useCases';

import { getAllTracks } from './getAllTracks';

export function exportMidiClip(clipId: string): void {
    const tracks = getAllTracks();
    const midi = getMidiStoreState();
    if (tracks.length === 0 || !midi) {
        return;
    }

    for (const track of tracks) {
        const clip = track.clips.find((candidateClip) => candidateClip.id === clipId);
        if (!clip) {
            continue;
        }
        // The file holds what the clip plays from its start to its end, every loop
        // pass included. Pitch-bend lanes are not exported.
        const { notes, controlChanges } = projectMidiClipPlayback({
            notes: midi.notesByClipId[clipId] ?? [],
            controlChanges: midi.ccByClipId[clipId] ?? [],
            clip: {
                id: clipId,
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
                midiOffsetBeats: clip.midiOffsetBeats,
                loopEnabled: clip.loopEnabled,
                loopLength: clip.loopLength,
            },
        });
        downloadMidiFile({
            clipName: clip.name || track.name,
            // The projection already places events on the timeline.
            clipStartBeat: 0,
            notes,
            ccs: controlChanges,
        });
        return;
    }

    downloadMidiFile({ clipName: 'export', clipStartBeat: 0, notes: [], ccs: [] });
}
