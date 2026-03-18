/**
 * Track Queries — use case layer exposing read-only track state
 * to cross-module consumers.
 *
 * Other modules should import from here rather than from
 * Track/repositories/trackRepository directly.
 */

import { getAllTracks as repoGetAllTracks, getTrackById as repoGetTrackById } from '../repositories/trackRepository';
import { type Track, type Clip, type TrackKind, createTrack as modelCreateTrack } from '../models/Track';
import { type MidiNote, type MidiCC, type MidiPitchBend, createMidiNote as modelCreateMidiNote } from '../models/MidiNote';
import { type AutomationLane, type AutomationPoint } from '../models/Automation';
import { type DeviceParameter, type DeviceParameterType, BUILTIN_PLUGINS } from '../models/DeviceParameter';
import { type SoundPresetCategory, type SoundPreset } from '../models/SoundPreset';
import { type WarpState } from '../models/WarpMarker';
import { midiStore } from '../stores/midiStore';
import { automationStore } from '../stores/automationStore';
import { midiLearnStore, type MidiLearnState } from '../stores/midiLearnStore';
import { trackStore } from '../stores/trackStore';

export type { Track, Clip, MidiNote, MidiCC, MidiPitchBend, AutomationLane, AutomationPoint, MidiLearnState, SoundPresetCategory, SoundPreset, TrackKind, DeviceParameter, DeviceParameterType, WarpState };
export type { Device } from '../models/Track';
export { BUILTIN_PLUGINS };

export { modelCreateTrack as createTrack };

/** Get all tracks. Returns empty array if store is not initialised. */
export function getAllTracks(): Track[] {
    return repoGetAllTracks();
}

/** Find a single track by id. */
export function getTrackById(trackId: string): Track | undefined {
    return repoGetTrackById(trackId);
}

/** Find a clip by id across all tracks. */
export function findClipById(clipId: string): Clip | undefined {
    const tracks = repoGetAllTracks();
    for (const track of tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return undefined;
}

/** Get the raw track store state snapshot. */
export function getTrackStoreState(): { tracks: Track[]; selectedTrackId: string | null } | null {
    return trackStore.value;
}

/** Get midi notes by clip id. */
export function getMidiNotesByClipId(): Record<string, MidiNote[]> {
    return midiStore.value?.notesByClipId ?? {};
}

/** Get the full midi store state snapshot. */
export function getMidiStoreState(): typeof midiStore.value {
    return midiStore.value;
}

/** Set the midi store state (for recording use cases). */
export function setMidiStoreState(state: NonNullable<typeof midiStore.value>): void {
    midiStore.set(state);
}

/** Get all automation lanes. */
export function getAutomationLanes(): AutomationLane[] {
    return automationStore.value?.lanes ?? [];
}

/** Get the full automation store state snapshot. */
export function getAutomationStoreState(): typeof automationStore.value {
    return automationStore.value;
}

/** Get the midi learn state snapshot. */
export function getMidiLearnState(): MidiLearnState | null {
    return midiLearnStore.value;
}

/** Create a new MidiNote with auto-generated id. */
export function createMidiNote(pitch: number, startBeat: number, duration: number, velocity?: number): MidiNote {
    return modelCreateMidiNote(pitch, startBeat, duration, velocity);
}

/** Set the track store state (for undo/redo handlers). */
export function setTrackStoreState(state: NonNullable<typeof trackStore.value>): void {
    trackStore.set(state);
}

/** Subscribe to track store changes. */
export function subscribeToTrackStore(callback: () => void): () => void {
    return trackStore.subscribe(callback);
}

