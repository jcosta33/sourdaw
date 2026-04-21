import { logger } from '#/infra/logger/appLogger';
import { midiStore } from '#/modules/MIDI/stores';

import { type Clip } from '../../models/Track';
import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';

export function glueClips(clipIds: string[]): void {
    const state = getTrackState();
    if (!state || clipIds.length < 2) {
        return;
    }

    // Guard: reject selections that span multiple tracks
    const tracksWithMatchingClips = state.tracks.filter((time) => time.clips.some((context) => clipIds.includes(context.id)));
    if (tracksWithMatchingClips.length > 1) {
        logger.warn('glueClips: clips span multiple tracks — gluing is only supported within a single track');
        return;
    }

    const firstTrack = tracksWithMatchingClips[0];
    if (!firstTrack) {
        return;
    }
    const clips = firstTrack.clips.filter((context) => clipIds.includes(context.id));
    if (clips.length < 2) {
        return;
    }
    let startBeat = Infinity;
    let endBeat = -Infinity;
    for (const context of clips) {
        if (context.startBeat < startBeat) {
            startBeat = context.startBeat;
        }
        if (context.endBeat > endBeat) {
            endBeat = context.endBeat;
        }
    }
    const gluedId = getNextClipId();
    const glued: Clip = {
        id: gluedId,
        trackId: firstTrack.id,
        name: `${clips[0]!.name} (glued)`,
        startBeat,
        endBeat,
        type: clips[0]!.type,
        fadeInBeats: clips[0]!.fadeInBeats,
        fadeOutBeats: clips[clips.length - 1]!.fadeOutBeats,
        gain: 1.0,
        color: clips[0]!.color,
        locked: false,
        muted: false,
    };
    updateTrack(firstTrack.id, (time) => ({
        ...time,
        clips: [...time.clips.filter((context) => !clipIds.includes(context.id)), glued],
    }));

    // Merge MIDI data from source clips into the glued clip
    const midiState = midiStore.value;
    if (midiState) {
        const mergedNotes = clipIds.flatMap((id) => midiState.notesByClipId[id] ?? []);
        const mergedCc = clipIds.flatMap((id) => midiState.ccByClipId[id] ?? []);
        const mergedPb = clipIds.flatMap((id) => midiState.pitchBendByClipId[id] ?? []);

        const newNotesByClipId = { ...midiState.notesByClipId };
        const newCcByClipId = { ...midiState.ccByClipId };
        const newPbByClipId = { ...midiState.pitchBendByClipId };

        // Remove source clip entries
        for (const id of clipIds) {
            delete newNotesByClipId[id];
            delete newCcByClipId[id];
            delete newPbByClipId[id];
        }

        // Add merged data for the glued clip (only if there is data)
        if (mergedNotes.length > 0) {
            newNotesByClipId[gluedId] = mergedNotes;
        }
        if (mergedCc.length > 0) {
            newCcByClipId[gluedId] = mergedCc;
        }
        if (mergedPb.length > 0) {
            newPbByClipId[gluedId] = mergedPb;
        }

        midiStore.set({
            notesByClipId: newNotesByClipId,
            ccByClipId: newCcByClipId,
            pitchBendByClipId: newPbByClipId,
        });
    }
}
