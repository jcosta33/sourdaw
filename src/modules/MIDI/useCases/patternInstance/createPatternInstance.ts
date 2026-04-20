import { getTrackStoreState, setTrackState } from '#/modules/Arrangement/useCases';

import { type Clip } from '../../models/TrackViewTypes';
import { getNotesForClip } from '../midiNoteCrud/getNotesForClip';
import { setNotesForClip } from '../midiNoteCrud/setNotesForClip';

/**
 * Create a pattern instance linked to a source clip.
 * The instance inherits MIDI notes and properties from the parent.
 */
export function createPatternInstance(sourceClipId: string, targetTrackId: string, startBeat: number): string | null {
    const state = getTrackStoreState();
    if (!state) {
        return null;
    }

    let sourceClip: Clip | undefined;
    for (const track of state.tracks) {
        sourceClip = track.clips.find((c) => c.id === sourceClipId);
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
        const clonedNotes = sourceNotes.map((n) => ({
            ...n,
            id: `note-inst-${crypto.randomUUID().slice(0, 8)}`,
            startBeat: n.startBeat + offset,
        }));
        setNotesForClip(instanceId, clonedNotes);
    }

    const targetTrack = state.tracks.find((t) => t.id === targetTrackId);
    if (!targetTrack) {
        return null;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) => (t.id === targetTrackId ? { ...t, clips: [...t.clips, instance] } : t)),
    });

    return instanceId;
}
