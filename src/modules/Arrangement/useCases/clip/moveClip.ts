import { shiftClipAutomation } from '#/modules/Automation/useCases';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';

export function moveClip(clipId: string, targetTrackId: string, startBeat: number, originalStartBeat?: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    // Guard against moving to a track that doesn't exist. The strip-then-readd
    // logic below removes the clip from its source track unconditionally and
    // only re-inserts it into the track whose id matches targetTrackId — so a
    // bad target id would silently delete the clip with no error.
    if (!state.tracks.some((time) => time.id === targetTrackId)) {
        return;
    }

    let movedClip: Clip | undefined;
    let oldStartBeat: number | undefined;
    const tracksWithoutClip = state.tracks.map((time) => {
        const clip = time.clips.find((context) => context.id === clipId);
        if (clip) {
            oldStartBeat = clip.startBeat;
            movedClip = {
                ...clip,
                trackId: targetTrackId,
                startBeat,
                endBeat: startBeat + (clip.endBeat - clip.startBeat),
            };
        }
        return { ...time, clips: time.clips.filter((context) => context.id !== clipId) };
    });

    if (!movedClip || oldStartBeat === undefined) {
        return;
    }

    setTrackState({
        ...state,
        tracks: tracksWithoutClip.map((time) =>
            time.id === targetTrackId ? { ...time, clips: [...time.clips, movedClip!] } : time
        ),
    });

    // Automation: shift from the original drag start (preview doesn't shift automation)
    const automationDelta = startBeat - (originalStartBeat ?? oldStartBeat);
    if (automationDelta !== 0) {
        shiftClipAutomation(clipId, automationDelta);
    }

    // MIDI: no shift — notes are stored clip-relative (playback position is
    // clip.startBeat + note.startBeat - midiOffsetBeats), so they follow the
    // clip's rectangle automatically. Shifting them here double-moved every
    // note on every drag (re-validation finding, ledger M-025 family).
}
