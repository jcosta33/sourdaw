import { getTrackState, setTrackState } from '#/modules/Arrangement/repositories/track';
import { type Clip } from '#/modules/Arrangement/models/Track';
import { shiftClipAutomation } from '#/modules/Automation/useCases/automation';
import { shiftClipMidiNotes } from '#/modules/MIDI/useCases/midiNoteCrud';

export function moveClip(clipId: string, targetTrackId: string, startBeat: number, originalStartBeat?: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    let movedClip: Clip | undefined;
    let oldStartBeat: number | undefined;
    const tracksWithoutClip = state.tracks.map((t) => {
        const clip = t.clips.find((c) => c.id === clipId);
        if (clip) {
            oldStartBeat = clip.startBeat;
            movedClip = {
                ...clip,
                trackId: targetTrackId,
                startBeat,
                endBeat: startBeat + (clip.endBeat - clip.startBeat),
            };
        }
        return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
    });

    if (!movedClip || oldStartBeat === undefined) {
        return;
    }

    setTrackState({
        ...state,
        tracks: tracksWithoutClip.map((t) => (t.id === targetTrackId ? { ...t, clips: [...t.clips, movedClip!] } : t)),
    });

    const beatDelta = startBeat - (originalStartBeat ?? oldStartBeat);
    if (beatDelta !== 0) {
        shiftClipAutomation(clipId, beatDelta);
        shiftClipMidiNotes(clipId, beatDelta);
    }
}
