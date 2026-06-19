import { appendClipToTrack, trackStore } from '#/modules/Arrangement/stores';

import { type Clip } from '../../models/TrackViewTypes';
import { getNotesForClip } from '../midiNoteCrud/getNotesForClip';
import { setNotesForClip } from '../midiNoteCrud/setNotesForClip';

/**
 * Create a pattern instance linked to a source clip.
 * The instance inherits MIDI notes and properties from the parent.
 */
export function createPatternInstance(sourceClipId: string, targetTrackId: string, startBeat: number): string | null {
    const state = trackStore.value;
    if (!state) {
        return null;
    }

    let sourceClip: Clip | undefined;
    for (const track of state.tracks) {
        sourceClip = track.clips.find((context) => context.id === sourceClipId);
        if (sourceClip) {
            break;
        }
    }
    if (!sourceClip) {
        return null;
    }

    const parentId = sourceClip.parentClipId ?? sourceClipId;
    const duration = sourceClip.endBeat - sourceClip.startBeat;

    const instanceId = `clip-inst-${crypto.randomUUID()}`;
    const instance: Clip = {
        id: instanceId,
        trackId: targetTrackId,
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
    };

    const sourceNotes = getNotesForClip(sourceClipId);
    if (sourceNotes.length > 0) {
        const offset = startBeat - sourceClip.startBeat;
        const clonedNotes = sourceNotes.map((node) => ({
            ...node,
            id: `note-inst-${crypto.randomUUID()}`,
            startBeat: node.startBeat + offset,
        }));
        setNotesForClip(instanceId, clonedNotes);
    }

    if (!state.tracks.some((track) => track.id === targetTrackId)) {
        return null;
    }

    appendClipToTrack(targetTrackId, instance);

    return instanceId;
}
