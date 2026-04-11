/**
 * Pattern Instance Use Cases.
 *
 * Figma-style linked clips: edit the parent and all instances update,
 * except for properties explicitly overridden on the instance.
 */

import {
    getTrackStoreState,
    setTrackState,
    updateClip,
} from '#/modules/Arrangement/useCases';
import { type Clip } from '../models/TrackViewTypes';
import { getNotesForClip } from './midiNoteCrud/getNotesForClip';
import { setNotesForClip } from './midiNoteCrud/setNotesForClip';

let nextInstanceId = 5000;

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

    const instanceId = `clip-inst-${nextInstanceId++}`;
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

/**
 * Detach a pattern instance — break the link, making it independent.
 */
export function detachPatternInstance(clipId: string): void {
    updateClip(clipId, (c) => {
        if (!c.parentClipId) {
            return c;
        }
        const { parentClipId: _, overrides: __, ...rest } = c;
        return rest;
    });
}

/**
 * Get all instance clip IDs linked to a parent.
 */
export function getPatternInstances(parentClipId: string): string[] {
    const state = getTrackStoreState();
    if (!state) {
        return [];
    }

    const instances: string[] = [];
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.parentClipId === parentClipId) {
                instances.push(clip.id);
            }
        }
    }
    return instances;
}

/**
 * Propagate parent MIDI notes to all linked instances.
 * Called after editing notes on a parent clip.
 * Instances that override 'notes' are skipped.
 */
export function propagateParentChanges(parentClipId: string): void {
    const state = getTrackStoreState();
    if (!state) {
        return;
    }

    let parentClip: Clip | undefined;
    for (const track of state.tracks) {
        parentClip = track.clips.find((c) => c.id === parentClipId);
        if (parentClip) {
            break;
        }
    }
    if (!parentClip) {
        return;
    }

    const parentNotes = getNotesForClip(parentClipId);

    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.parentClipId !== parentClipId) {
                continue;
            }
            if (clip.overrides?.notes) {
                continue;
            }

            const offset = clip.startBeat - parentClip.startBeat;
            const clonedNotes = parentNotes.map((n) => ({
                ...n,
                id: `note-inst-${crypto.randomUUID().slice(0, 8)}`,
                startBeat: n.startBeat + offset,
            }));
            setNotesForClip(clip.id, clonedNotes);
        }
    }
}
