import { pushUndoEntry } from '#/modules/Command/useCases';
import { removeMidiClipData, splitMidiNotesAtBeat } from '#/modules/MIDI/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';

export function deleteTimeRange(startBeat: number, endBeat: number, trackIds: string[]): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const deletedClipIds: string[] = [];
    const splitOps: Array<{ sourceClipId: string; newClipId: string; splitBeat: number }> = [];

    const newTracks = state.tracks.map((track) => {
        if (!trackIds.includes(track.id)) {
            return track;
        }

        const finalClips: typeof track.clips extends (infer U)[] ? U[] : never = [];

        for (const clip of track.clips) {
            if (clip.startBeat >= startBeat && clip.endBeat <= endBeat) {
                // Fully inside — remove clip and clean up MIDI
                deletedClipIds.push(clip.id);
                continue;
            } else if (clip.startBeat < startBeat && clip.endBeat > endBeat) {
                // Spans the range — split into left and right, removing the middle
                const rightClipId = `clip-dtr-${crypto.randomUUID().slice(0, 8)}`;
                const leftClip = { ...clip, endBeat: startBeat, name: `${clip.name} (L)` };
                const rightClip = {
                    ...clip,
                    id: rightClipId,
                    startBeat: endBeat,
                    name: `${clip.name} (R)`,
                    audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (endBeat - clip.startBeat),
                    // Right-side notes are re-based onto this clip at split
                    // time, so its MIDI media starts at the split point.
                    midiOffsetBeats: 0,
                };
                finalClips.push(leftClip, rightClip);
                if (clip.type === 'midi') {
                    // splitMidiNotesAtBeat partitions in clip-media beats
                    // (notes are clip-relative), not timeline beats.
                    splitOps.push({
                        sourceClipId: clip.id,
                        newClipId: rightClipId,
                        splitBeat: startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0),
                    });
                }
            } else if (clip.startBeat < startBeat && clip.endBeat > startBeat) {
                finalClips.push({ ...clip, endBeat: startBeat });
            } else if (clip.startBeat < endBeat && clip.endBeat > endBeat) {
                finalClips.push({
                    ...clip,
                    startBeat: endBeat,
                    audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (endBeat - clip.startBeat),
                });
            } else {
                finalClips.push(clip);
            }
        }

        return { ...track, clips: finalClips };
    });

    const originalTracks = state.tracks;

    pushUndoEntry(
        'Delete Time Range',
        () => {
            const currentState = getTrackState();
            if (currentState) {
                setTrackState({ ...currentState, tracks: originalTracks });
            }
        },
        () => {
            const currentState = getTrackState();
            if (currentState) {
                setTrackState({ ...currentState, tracks: newTracks });
            }
        }
    );

    setTrackState({ ...state, tracks: newTracks });

    for (const id of deletedClipIds) {
        removeMidiClipData([id]);
    }
    for (const op of splitOps) {
        splitMidiNotesAtBeat(op);
    }
}
