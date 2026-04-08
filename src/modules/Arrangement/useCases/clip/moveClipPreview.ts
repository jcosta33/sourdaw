import { inject } from '#/infra/di/inject';
import { getTrackState } from '#/modules/Arrangement/repositories/track/getTrackState';
import { setTrackState } from '#/modules/Arrangement/repositories/track/setTrackState';
import { type Clip } from '#/modules/Arrangement/models/Track';
import { shiftClipMidiNotes } from '#/modules/MIDI/useCases/midiNoteCrud/shiftClipMidiNotes';

export const moveClipPreview = inject({ getTrackState, setTrackState })(
    ({ getTrackState, setTrackState }) =>
        function moveClipPreview(clipId: string, targetTrackId: string, startBeat: number): void {
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
                    const targetTrack = state.tracks.find((tr) => tr.id === targetTrackId);
                    const effectiveTargetId =
                        targetTrack &&
                        ((clip.type === 'audio' && targetTrack.kind !== 'audio') ||
                            (clip.type === 'midi' && targetTrack.kind !== 'midi'))
                            ? t.id
                            : targetTrackId;
                    movedClip = {
                        ...clip,
                        trackId: effectiveTargetId,
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
                    t.id === movedClip!.trackId ? { ...t, clips: [...t.clips, movedClip!] } : t
                ),
            });

            // Shift MIDI notes by the incremental delta so they move with the clip during drag
            const beatDelta = startBeat - oldStartBeat;
            if (beatDelta !== 0) {
                shiftClipMidiNotes(clipId, beatDelta);
            }
        }
);
