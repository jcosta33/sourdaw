import { appendClipToTrack, resolveEligibleClipWriteTarget, trackStore } from '#/modules/Arrangement/stores';

import { type Clip } from '../../models/TrackViewTypes';
import { getNotesForClip } from '../midiNoteCrud/getNotesForClip';
import { setNotesForClip } from '../midiNoteCrud/setNotesForClip';

/**
 * Create a pattern instance linked to a source clip.
 * The instance inherits MIDI notes and properties from the parent.
 */
export function createPatternInstance(sourceClipId: string, targetTrackId: string, startBeat: number): string | null {
    const sourceTarget = resolveEligibleClipWriteTarget({ clipId: sourceClipId });
    if (sourceTarget.status !== 'eligible' || !('clipId' in sourceTarget)) {
        return null;
    }

    const destinationTarget = resolveEligibleClipWriteTarget({ trackId: targetTrackId });
    if (destinationTarget.status !== 'eligible') {
        return null;
    }

    const state = trackStore.value;
    if (!state) {
        return null;
    }

    const sourceTrack = state.tracks.find((track) => track.id === sourceTarget.trackId);
    const sourceClip = sourceTrack?.clips.find((clip) => clip.id === sourceTarget.clipId);
    if (!sourceClip) {
        return null;
    }

    const parentId = sourceClip.parentClipId ?? sourceClipId;
    const duration = sourceClip.endBeat - sourceClip.startBeat;

    const instanceId = `clip-inst-${crypto.randomUUID()}`;
    const instance: Clip = {
        id: instanceId,
        trackId: destinationTarget.trackId,
        name: `${sourceClip.name} (instance)`,
        startBeat,
        endBeat: startBeat + duration,
        type: sourceClip.type,
        fadeInBeats: sourceClip.fadeInBeats,
        fadeOutBeats: sourceClip.fadeOutBeats,
        gain: sourceClip.gain,
        color: sourceClip.color,
        locked: false,
        muted: false,
        parentClipId: parentId,
        overrides: {},
        // The notes are cloned clip-relative, so the instance must inherit
        // the parent's media offset or slipped parents play displaced.
        midiOffsetBeats: sourceClip.midiOffsetBeats,
    };

    const didAppend = appendClipToTrack(destinationTarget.trackId, instance);
    if (!didAppend) {
        return null;
    }

    const sourceNotes = getNotesForClip(sourceClipId);
    if (sourceNotes.length > 0) {
        // Notes are clip-relative: playback adds the instance clip's own
        // start, so the clones keep the parent's beats verbatim (adding the
        // instance-parent offset displaced or silenced instances, M-142).
        const clonedNotes = sourceNotes.map((node) => ({
            ...node,
            id: `note-inst-${instanceId}-${node.id}`,
        }));
        setNotesForClip(instanceId, clonedNotes);
    }

    return instanceId;
}
