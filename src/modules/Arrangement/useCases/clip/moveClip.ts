import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { type Clip } from '../../models/Track';
import { shiftClipAutomation } from '#/modules/Automation';
import { shiftClipMidiNotes } from '#/modules/MIDI/useCases';

export function moveClip(
    clipId: string,
    targetTrackId: string,
    startBeat: number,
    originalStartBeat?: number
): void {
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
        tracks: tracksWithoutClip.map((t) =>
            t.id === targetTrackId ? { ...t, clips: [...t.clips, movedClip!] } : t
        ),
    });

    // Automation: shift from the original drag start (preview doesn't shift automation)
    const automationDelta = startBeat - (originalStartBeat ?? oldStartBeat);
    if (automationDelta !== 0) {
        shiftClipAutomation(clipId, automationDelta);
    }

    // MIDI: shift by the total delta from the clip's current position (preview no longer shifts incrementally)
    const midiDelta = startBeat - oldStartBeat;
    if (midiDelta !== 0) {
        shiftClipMidiNotes(clipId, midiDelta);
    }
}
