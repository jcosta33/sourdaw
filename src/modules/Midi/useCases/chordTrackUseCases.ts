/**
 * Chord Track use cases — public contract.
 *
 * Manages a global chord track that provides harmonic context for the entire
 * project. MIDI tracks can "follow" the chord track, auto-transposing notes
 * during playback to match the active chord at each beat position.
 */

import { chordTrackStore } from '#/modules/Track/stores/chordTrackStore';
import { createChordEvent, type ChordEvent } from '../models/ChordEvent';
import { type ChordType, CHORD_TYPES } from './chordStamps';

// Re-export types for cross-module consumption (DTO pattern)
export type { ChordEvent } from '../models/ChordEvent';
export { formatChordName, ROOT_NAMES } from '../models/ChordEvent';
export { type ChordType, CHORD_TYPE_KEYS } from './chordStamps';

// ── CRUD ──────────────────────────────────────────────────────────────────

export function addChordEvent(
    beat: number,
    root: number,
    quality: ChordType,
    duration: number
): ChordEvent | null {
    const state = chordTrackStore.value;
    if (!state) {
        return null;
    }

    const event = createChordEvent(beat, root, quality, duration);
    const events = [...state.events, event].sort((a, b) => a.beat - b.beat);

    chordTrackStore.set({ ...state, events });
    return event;
}

export function removeChordEvent(eventId: string): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }

    chordTrackStore.set({
        ...state,
        events: state.events.filter((e) => e.id !== eventId),
    });
}

export function moveChordEvent(eventId: string, newBeat: number): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }

    const events = state.events
        .map((e) => (e.id === eventId ? { ...e, beat: Math.max(0, newBeat) } : e))
        .sort((a, b) => a.beat - b.beat);

    chordTrackStore.set({ ...state, events });
}

export function updateChordEvent(eventId: string, partial: Partial<Pick<ChordEvent, 'root' | 'quality' | 'duration'>>): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }

    const events = state.events.map((e) =>
        e.id === eventId
            ? {
                  ...e,
                  ...(partial.root !== undefined ? { root: partial.root % 12 } : {}),
                  ...(partial.quality !== undefined ? { quality: partial.quality } : {}),
                  ...(partial.duration !== undefined ? { duration: Math.max(0.25, partial.duration) } : {}),
              }
            : e
    );

    chordTrackStore.set({ ...state, events });
}

export function clearChordTrack(): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }
    chordTrackStore.set({ ...state, events: [] });
}

export function toggleChordTrack(enabled?: boolean): void {
    const state = chordTrackStore.value;
    if (!state) {
        return;
    }
    chordTrackStore.set({ ...state, enabled: enabled ?? !state.enabled });
}

// ── Queries ───────────────────────────────────────────────────────────────

/** Returns the active chord event at the given beat, or null if none. */
export function getChordAtBeat(beat: number): ChordEvent | null {
    const state = chordTrackStore.value;
    if (!state || !state.enabled || state.events.length === 0) {
        return null;
    }

    // Find the last event whose beat ≤ the query beat and whose range covers it
    for (let i = state.events.length - 1; i >= 0; i--) {
        const event = state.events[i]!;
        if (event.beat <= beat && beat < event.beat + event.duration) {
            return event;
        }
    }
    return null;
}


// ── Harmonic Following ────────────────────────────────────────────────────

/**
 * Map a MIDI pitch relative to a chord root to scale-degree space,
 * then re-map to a new chord root. Non-chord tones pass through with
 * a simple chromatic offset.
 *
 * This preserves the musical "function" of each note:
 * - A root note stays a root note
 * - A 3rd stays a 3rd (adjusting for quality change, e.g. major→minor)
 * - Non-chord tones shift by the root difference
 */
export function transposeNoteToChord(
    pitch: number,
    fromRoot: number,
    fromQuality: ChordType,
    toRoot: number,
    toQuality: ChordType
): number {
    if (fromRoot === toRoot && fromQuality === toQuality) {
        return pitch;
    }

    const fromIntervals = Array.from(CHORD_TYPES[fromQuality]) as number[];
    const toIntervals = Array.from(CHORD_TYPES[toQuality]) as number[];

    // Determine the note's interval relative to the source root
    const semitoneFromRoot = ((pitch - fromRoot) % 12 + 12) % 12;

    // Check if this note is a chord tone in the source chord
    const chordToneIndex = fromIntervals.indexOf(semitoneFromRoot);

    if (chordToneIndex !== -1 && chordToneIndex < toIntervals.length) {
        // It's a chord tone — map to the same index in the target chord
        const targetInterval = toIntervals[chordToneIndex] ?? 0;
        const octave = Math.floor((pitch - fromRoot) / 12);
        return toRoot + octave * 12 + targetInterval;
    }

    // Non-chord tone: simple chromatic shift by root difference
    const rootDiff = toRoot - fromRoot;
    return pitch + rootDiff;
}

/**
 * Convenience: transpose a MIDI pitch given two ChordEvent objects.
 * If either is null, returns original pitch unchanged.
 */
export function transposeForChordTrack(
    pitch: number,
    referenceChord: ChordEvent | null,
    targetChord: ChordEvent | null
): number {
    if (!referenceChord || !targetChord) {
        return pitch;
    }
    return transposeNoteToChord(pitch, referenceChord.root, referenceChord.quality, targetChord.root, targetChord.quality);
}
