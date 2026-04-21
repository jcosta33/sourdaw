/**
 * DSO Compiler — compiles Domain-Specific Operations into concrete DAW store mutations.
 *
 * Each DSO type maps to specific use case calls. Validation is performed
 * before execution. Human-readable summaries are generated for the action history.
 */
import { logger } from '#/infra/logger/appLogger';
import {
    applyChordProgressionToTrack,
    applyDrumPatternToTrack,
    applyMelodyToTrack,
} from '#/modules/AiGeneration/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip, addDevice, addTrack, removeTrack, setSend } from '#/modules/Arrangement/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { humanizeNotes } from '#/modules/MIDI/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { disableLooping, setLoopRegion } from '#/modules/Transport/useCases';

import { type Dso } from '../../models/DsoTypes';

// Shared style unions live in `AiGeneration/models/GenerationStyles` — a leaf
// module with no runtime imports. Using `import type` keeps this file free of
// any runtime dependency on `AiGeneration/useCases`, which would otherwise
// close a module-init circular dependency. The unions are the single source
// of truth for both the algorithms in `AiGeneration` and the Record-based
// lookup maps below.
import type {
    ChordProgressionStyle,
    ChordVoicing,
    DrumPatternStyle,
    MelodyStyle,
    ScaleType,
} from '#/modules/AiGeneration/models/GenerationStyles';

// ── Safe enum mapping ────────────────────────────────────────────────────────

const NOTE_NAME_TO_MIDI: Record<string, number> = {
    C: 60,
    'C#': 61,
    Db: 61,
    D: 62,
    'D#': 63,
    Eb: 63,
    E: 64,
    F: 65,
    'F#': 66,
    Gb: 66,
    G: 67,
    'G#': 68,
    Ab: 68,
    A: 69,
    'A#': 70,
    Bb: 70,
    B: 71,
};

function noteNameToMidi(name: string): number {
    return NOTE_NAME_TO_MIDI[name] ?? NOTE_NAME_TO_MIDI[name.charAt(0).toUpperCase() + name.slice(1)] ?? 60;
}

// Record-based lookups — values are typed literals, keys are strings the LLM might produce.
// No casts needed: the Record values ARE the correct types.

const MELODY_STYLE_MAP: Record<string, MelodyStyle> = {
    simple: 'simple',
    arpeggiated: 'arpeggiated',
    stepwise: 'stepwise',
    rhythmic: 'rhythmic',
    ambient: 'ambient',
};

const SCALE_MAP: Record<string, ScaleType> = {
    major: 'major',
    minor: 'minor',
    pentatonic: 'pentatonic',
    'minor-pentatonic': 'minor-pentatonic',
    blues: 'blues',
    dorian: 'dorian',
    mixolydian: 'mixolydian',
    lydian: 'lydian',
    phrygian: 'phrygian',
    locrian: 'locrian',
    'harmonic-minor': 'harmonic-minor',
    'melodic-minor': 'melodic-minor',
    'whole-tone': 'whole-tone',
    chromatic: 'chromatic',
};

const CHORD_STYLE_MAP: Record<string, ChordProgressionStyle> = {
    pop: 'pop',
    jazz: 'jazz',
    classical: 'classical',
    edm: 'edm',
    blues: 'blues',
    rnb: 'rnb',
    folk: 'folk',
    cinematic: 'cinematic',
    'neo-soul': 'neo-soul',
    gospel: 'gospel',
    rock: 'rock',
    lofi: 'lofi',
    // Common LLM aliases
    'I-IV-V-I': 'blues',
    'I-V-vi-IV': 'pop',
    'ii-V-I': 'jazz',
    'I-vi-IV-V': 'pop',
    '12-bar-blues': 'blues',
};

const CHORD_VOICING_MAP: Record<string, ChordVoicing> = {
    close: 'close',
    open: 'open',
    spread: 'spread',
    power: 'power',
    basic: 'close',
    drop2: 'open',
};

const DRUM_STYLE_MAP: Record<string, DrumPatternStyle> = {
    rock: 'rock',
    pop: 'four-on-floor',
    hiphop: 'trap',
    jazz: 'jazz',
    blues: 'blues',
    electronic: 'four-on-floor',
    latin: 'latin',
    funk: 'breakbeat',
    'four-on-floor': 'four-on-floor',
    breakbeat: 'breakbeat',
    trap: 'trap',
    dnb: 'dnb',
    'half-time': 'half-time',
    reggae: 'reggae',
    lofi: 'lofi',
    house: 'house',
    techno: 'techno',
    synthwave: 'synthwave',
    afrobeat: 'afrobeat',
    metal: 'metal',
    punk: 'punk',
};

function toMelodyStyle(state: string): MelodyStyle {
    return MELODY_STYLE_MAP[state.toLowerCase()] ?? 'simple';
}

function toScaleType(state: string): ScaleType {
    return SCALE_MAP[state.toLowerCase()] ?? 'major';
}

function toChordStyle(state: string): ChordProgressionStyle {
    return CHORD_STYLE_MAP[state] ?? CHORD_STYLE_MAP[state.toLowerCase()] ?? 'pop';
}

function toChordVoicing(state: string): ChordVoicing {
    return CHORD_VOICING_MAP[state.toLowerCase()] ?? 'close';
}

function toDrumStyle(state: string): DrumPatternStyle {
    return DRUM_STYLE_MAP[state.toLowerCase()] ?? 'rock';
}

/**
 * Per-execution context for a single `executeDsos()` call.
 * Tracks the ID of the most recently inserted device so that the LLM's
 * `device_id: "latest"` sentinel can be resolved to a concrete ID.
 *
 * Held in a local variable inside `executeDsos()` rather than at module
 * scope so concurrent plan executions (e.g. an AI chat response that
 * triggers while a prior AI edit is still mid-execution) cannot clobber
 * each other's in-flight device references.
 */
type DsoExecContext = {
    lastInsertedDeviceId: string | null;
};

// ── Name resolution ──────────────────────────────────────────────────────────
// The LLM outputs human-readable names (e.g. "Drums", "Vocal Clip").
// We resolve them to actual store IDs before validation and execution.

// ── Fuzzy name matching ──────────────────────────────────────────────────────

/**
 * Score how well `query` matches `candidate` (0 = no match, higher = better).
 * Handles typos, partial matches, and case differences.
 */
function fuzzyScore(query: string, candidate: string): number {
    const query1 = query.toLowerCase();
    const context = candidate.toLowerCase();

    // Exact match
    if (query1 === context) {
        return 100;
    }

    // Candidate contains query as substring
    if (context.includes(query1)) {
        return 80;
    }

    // Query contains candidate
    if (query1.includes(context)) {
        return 70;
    }

    // Token overlap (handles "drum bus" matching "Drum Bus Send")
    const qTokens = query1.split(/[\s_-]+/);
    const cTokens = context.split(/[\s_-]+/);
    let tokenHits = 0;
    for (const qt of qTokens) {
        if (qt.length < 2) {
            continue;
        }
        if (cTokens.some((ct) => ct.includes(qt) || qt.includes(ct))) {
            tokenHits++;
        }
    }
    if (tokenHits > 0) {
        return 40 + (tokenHits / Math.max(qTokens.length, 1)) * 30;
    }

    // Levenshtein-based typo tolerance (only for short strings to avoid expense)
    if (query1.length <= 15 && context.length <= 20) {
        const dist = levenshtein(query1, context);
        const maxLen = Math.max(query1.length, context.length);
        const similarity = 1 - dist / maxLen;
        if (similarity > 0.6) {
            return similarity * 50;
        }
    }

    return 0;
}

function levenshtein(alpha: string, b: string): number {
    const message = alpha.length;
    const node = b.length;
    const dp: number[][] = Array.from({ length: message + 1 }, (_, index) =>
        Array.from({ length: node + 1 }, (_, jIndex) => (index === 0 ? jIndex : jIndex === 0 ? index : 0))
    );
    for (let index = 1; index <= message; index++) {
        for (let jIndex = 1; jIndex <= node; jIndex++) {
            dp[index]![jIndex] =
                alpha[index - 1] === b[jIndex - 1]
                    ? dp[index - 1]![jIndex - 1]!
                    : 1 + Math.min(dp[index - 1]![jIndex]!, dp[index]![jIndex - 1]!, dp[index - 1]![jIndex - 1]!);
        }
    }
    return dp[message]![node]!;
}

function bestMatch<T>(query: string, items: T[], getName: (item: T) => string, threshold = 30): T | null {
    let best: T | null = null;
    let bestScore = 0;
    for (const item of items) {
        const score = fuzzyScore(query, getName(item));
        if (score > bestScore && score >= threshold) {
            best = item;
            bestScore = score;
        }
    }
    return best;
}

// ── Name resolution ──────────────────────────────────────────────────────────

/**
 * Resolve name-based references in DSOs to actual store IDs.
 * Uses fuzzy matching to handle typos and partial names.
 * Mutates the DSO objects in-place.
 * Returns unresolved names as errors.
 */
export function resolveDsoNames(dsos: Dso[]): DsoValidationError[] {
    const state = trackStore.value;
    if (!state) {
        return [];
    }

    const errors: DsoValidationError[] = [];
    const allClips = state.tracks.flatMap((time) => time.clips);
    const allDevices = state.tracks.flatMap((time) => time.devices);

    // Keep track of dynamically created tracks during this resolve pass
    const mockTracks: { id: string; name: string }[] = [];

    function findTrackId(nameOrId: string): string | null {
        if (state!.tracks.some((time) => time.id === nameOrId)) {
            return nameOrId;
        }
        if (mockTracks.some((time) => time.id === nameOrId)) {
            return nameOrId;
        }

        let match = bestMatch(nameOrId, state!.tracks, (time) => time.name);
        if (!match) {
            match = bestMatch(nameOrId, mockTracks, (time) => time.name) as any;
        }
        return match?.id ?? null;
    }

    function findClipId(nameOrId: string): string | null {
        if (allClips.some((context) => context.id === nameOrId)) {
            return nameOrId;
        }
        const match = bestMatch(nameOrId, allClips, (context) => context.name);
        return match?.id ?? null;
    }

    function findDeviceId(nameOrId: string): string | null {
        if (nameOrId === 'latest') {
            return 'latest';
        }
        if (allDevices.some((data) => data.id === nameOrId)) {
            return nameOrId;
        }
        const match = bestMatch(nameOrId, allDevices, (data) => data.type);
        return match?.id ?? null;
    }

    let index = 0;
    while (index < dsos.length) {
        const dso = dsos[index]!;

        // Resolve track_id fields
        if ('track_id' in dso && typeof dso.track_id === 'string') {
            const resolved = findTrackId(dso.track_id);
            if (resolved) {
                (dso as Record<string, unknown>).track_id = resolved;
            } else if (!['add_track'].includes(dso.op)) {
                // Check if the LLM meant the selected track
                const selectedTrackId = state.selectedTrackId;
                const selectedTrack = selectedTrackId ? state.tracks.find((time) => time.id === selectedTrackId) : null;
                const lowerName = dso.track_id.toLowerCase();
                const isSelectedRef =
                    lowerName.includes('selected') || lowerName.includes('current') || lowerName.includes('this');

                if (isSelectedRef && selectedTrack) {
                    // Resolve to the actually selected track
                    (dso as Record<string, unknown>).track_id = selectedTrack.id;
                } else {
                    // Fallback: auto-create this track
                    const newId = `track-${crypto.randomUUID().slice(0, 8)}`;
                    const kindFallback =
                        dso.op === 'generate_drums' || lowerName.includes('drum') || lowerName.includes('midi')
                            ? 'midi'
                            : 'audio';

                    dsos.splice(index, 0, {
                        op: 'add_track',
                        name: dso.track_id,
                        kind: kindFallback as any,
                        track_id: newId,
                    } as any);

                    mockTracks.push({ id: newId, name: dso.track_id });
                    (dso as Record<string, unknown>).track_id = newId;
                    index++;
                }
            }
        }

        // Resolve destination_track_id
        if ('destination_track_id' in dso && typeof dso.destination_track_id === 'string') {
            const resolved = findTrackId(dso.destination_track_id);
            if (resolved) {
                (dso as Record<string, unknown>).destination_track_id = resolved;
            } else {
                errors.push({ dso, reason: `Could not find destination track "${dso.destination_track_id}"` });
            }
        }

        // Resolve from_track_id / to_track_id
        if ('from_track_id' in dso && typeof dso.from_track_id === 'string') {
            const resolved = findTrackId(dso.from_track_id);
            if (resolved) {
                (dso as Record<string, unknown>).from_track_id = resolved;
            } else {
                errors.push({ dso, reason: `Could not find source track "${dso.from_track_id}"` });
            }
        }
        if ('to_track_id' in dso && typeof dso.to_track_id === 'string') {
            const resolved = findTrackId(dso.to_track_id);
            if (resolved) {
                (dso as Record<string, unknown>).to_track_id = resolved;
            } else {
                errors.push({ dso, reason: `Could not find target track "${dso.to_track_id}"` });
            }
        }

        // Resolve clip_id fields
        if ('clip_id' in dso && typeof dso.clip_id === 'string') {
            const resolved = findClipId(dso.clip_id);
            if (resolved) {
                (dso as Record<string, unknown>).clip_id = resolved;
            } else {
                errors.push({ dso, reason: `Could not find clip "${dso.clip_id}"` });
            }
        }

        // Resolve device_id fields
        if ('device_id' in dso && typeof dso.device_id === 'string') {
            const resolved = findDeviceId(dso.device_id);
            if (resolved) {
                (dso as Record<string, unknown>).device_id = resolved;
            } else {
                errors.push({ dso, reason: `Could not find device "${dso.device_id}"` });
            }
        }

        index++;
    }

    return errors;
}

// ── Validation ───────────────────────────────────────────────────────────────

export type DsoValidationError = {
    dso: Dso;
    reason: string;
};

export function validateDsos(dsos: Dso[]): DsoValidationError[] {
    const errors: DsoValidationError[] = [];
    const state = trackStore.value;
    const trackIds = new Set(state?.tracks.map((time) => time.id) ?? []);
    const clipIds = new Set(state?.tracks.flatMap((time) => time.clips.map((context) => context.id)) ?? []);
    const deviceIds = new Set(state?.tracks.flatMap((time) => time.devices.map((data) => data.id)) ?? []);

    // Pre-register IDs injected by resolveDsoNames for add_track DSOs so that
    // subsequent DSOs in the same batch that target those new tracks are not
    // incorrectly rejected (the store hasn't been updated yet at validation time).
    for (const dso of dsos) {
        if (dso.op === 'add_track') {
            const injectedId = (dso as Record<string, unknown>).track_id;
            if (typeof injectedId === 'string') {
                trackIds.add(injectedId);
            }
        }
    }

    for (const dso of dsos) {
        switch (dso.op) {
            case 'remove_track':
            case 'rename_track':
            case 'set_track_volume':
            case 'set_track_pan':
            case 'mute_track':
            case 'solo_track':
            case 'arm_track':
            case 'color_track':
            case 'reorder_track':
                if (!trackIds.has(dso.track_id)) {
                    errors.push({ dso, reason: `Track "${dso.track_id}" does not exist` });
                }
                break;

            case 'insert_device':
                if (!trackIds.has(dso.track_id)) {
                    errors.push({ dso, reason: `Track "${dso.track_id}" does not exist` });
                }
                break;

            case 'add_clip':
                if (!trackIds.has(dso.track_id)) {
                    errors.push({ dso, reason: `Track "${dso.track_id}" does not exist` });
                }
                if (dso.end_beats <= dso.start_beats) {
                    errors.push({ dso, reason: `Clip end must be after start` });
                }
                break;

            case 'remove_clip':
            case 'rename_clip':
            case 'split_clip':
            case 'transpose_notes':
            case 'humanize_midi':
                if (!clipIds.has(dso.clip_id)) {
                    errors.push({ dso, reason: `Clip "${dso.clip_id}" does not exist` });
                }
                break;

            case 'move_clip':
            case 'duplicate_clip':
                if (!clipIds.has(dso.clip_id)) {
                    errors.push({ dso, reason: `Clip "${dso.clip_id}" does not exist` });
                }
                if (!trackIds.has(dso.destination_track_id)) {
                    errors.push({ dso, reason: `Destination track "${dso.destination_track_id}" does not exist` });
                }
                break;

            case 'remove_device':
            case 'bypass_device':
                if (!deviceIds.has(dso.device_id)) {
                    errors.push({ dso, reason: `Device "${dso.device_id}" does not exist` });
                }
                break;

            case 'set_tempo':
                if (dso.bpm < 20 || dso.bpm > 999) {
                    errors.push({ dso, reason: `Tempo ${dso.bpm} out of range (20-999)` });
                }
                break;

            case 'set_track_volume':
                if (dso.gain < 0 || dso.gain > 1.5) {
                    errors.push({ dso, reason: `Gain ${dso.gain} out of range (0-1.5)` });
                }
                break;

            case 'set_track_pan':
                if (dso.pan < -50 || dso.pan > 50) {
                    errors.push({ dso, reason: `Pan ${dso.pan} out of range (-50 to 50)` });
                }
                break;

            case 'create_send':
                if (!trackIds.has(dso.from_track_id)) {
                    errors.push({ dso, reason: `Source track "${dso.from_track_id}" does not exist` });
                }
                if (!trackIds.has(dso.to_track_id)) {
                    errors.push({ dso, reason: `Destination track "${dso.to_track_id}" does not exist` });
                }
                break;

            case 'set_device_param':
                if (dso.device_id !== 'latest' && !deviceIds.has(dso.device_id)) {
                    errors.push({ dso, reason: `Device "${dso.device_id}" does not exist` });
                }
                break;

            case 'add_midi_notes':
                if (!clipIds.has(dso.clip_id)) {
                    errors.push({ dso, reason: `Clip "${dso.clip_id}" does not exist` });
                }
                for (let index = 0; index < dso.notes.length; index++) {
                    const node = dso.notes[index]!;
                    if (node.pitch < 0 || node.pitch > 127) {
                        errors.push({ dso, reason: `Note ${index} pitch ${node.pitch} out of range (0-127)` });
                    }
                    if (node.velocity < 0 || node.velocity > 127) {
                        errors.push({ dso, reason: `Note ${index} velocity ${node.velocity} out of range (0-127)` });
                    }
                }
                break;

            case 'set_clip_gain':
                if (!clipIds.has(dso.clip_id)) {
                    errors.push({ dso, reason: `Clip "${dso.clip_id}" does not exist` });
                }
                if (dso.gain < 0 || dso.gain > 2) {
                    errors.push({ dso, reason: `Clip gain ${dso.gain} out of range (0-2)` });
                }
                break;

            case 'generate_melody':
            case 'generate_chords':
            case 'generate_drums':
                if (!trackIds.has(dso.track_id)) {
                    errors.push({ dso, reason: `Track "${dso.track_id}" does not exist` });
                }
                break;
        }
    }

    return errors;
}

// ── Compilation (execution) ──────────────────────────────────────────────────

/** Options passed to executeAppAction for all DSO sub-operations.
 *  skipUndo: the batch undo entry is managed by executeDsoEdit, not per-operation. */
const DSO_EXEC_OPTIONS = { skipUndo: true, source: 'ai' as const };

async function executeSingleDso(dso: Dso, context: DsoExecContext): Promise<void> {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    switch (dso.op) {
        case 'add_track': {
            addTrack({
                id: (dso as any).track_id,
                name: dso.name,
                kind: dso.kind as 'audio' | 'midi' | 'bus' | 'master',
            });
            break;
        }

        case 'remove_track': {
            removeTrack(dso.track_id);
            break;
        }

        case 'rename_track': {
            await executeAppAction(
                { type: 'renameTrack', payload: { trackId: dso.track_id, name: dso.name } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'set_track_volume': {
            await executeAppAction(
                { type: 'setTrackGain', payload: { trackId: dso.track_id, gain: dso.gain } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'set_track_pan': {
            await executeAppAction(
                { type: 'setTrackPan', payload: { trackId: dso.track_id, pan: dso.pan } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'mute_track': {
            await executeAppAction(
                { type: 'muteTrack', payload: { trackId: dso.track_id, muted: dso.muted } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'solo_track': {
            await executeAppAction(
                { type: 'soloTrack', payload: { trackId: dso.track_id, soloed: dso.soloed } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'arm_track': {
            await executeAppAction(
                { type: 'armTrack', payload: { trackId: dso.track_id, armed: dso.armed } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'color_track': {
            await executeAppAction(
                { type: 'setTrackColor', payload: { trackId: dso.track_id, color: dso.color } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'reorder_track': {
            await executeAppAction(
                { type: 'reorderTrack', payload: { trackId: dso.track_id, newIndex: dso.new_index } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'add_clip': {
            addClip({
                trackId: dso.track_id,
                name: dso.name,
                type: dso.type,
                startBeat: dso.start_beats,
                endBeat: dso.end_beats,
            });
            break;
        }

        case 'remove_clip': {
            await executeAppAction({ type: 'removeClip', payload: { clipId: dso.clip_id } }, DSO_EXEC_OPTIONS);
            break;
        }

        case 'rename_clip': {
            await executeAppAction(
                { type: 'renameClip', payload: { clipId: dso.clip_id, name: dso.name } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'move_clip': {
            await executeAppAction(
                {
                    type: 'moveClip',
                    payload: {
                        clipId: dso.clip_id,
                        trackId: dso.destination_track_id,
                        startBeat: dso.destination_start_beats,
                    },
                },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'duplicate_clip': {
            const allClips = state.tracks.flatMap((time) => time.clips);
            const sourceClip = allClips.find((context1) => context1.id === dso.clip_id);
            if (sourceClip) {
                const duration = sourceClip.endBeat - sourceClip.startBeat;
                addClip({
                    trackId: dso.destination_track_id,
                    name: `${sourceClip.name} (copy)`,
                    type: sourceClip.type ?? 'audio',
                    startBeat: dso.destination_start_beats,
                    endBeat: dso.destination_start_beats + duration,
                    audioBufferId: sourceClip.audioBufferId,
                });
            }
            break;
        }

        case 'split_clip': {
            await executeAppAction(
                { type: 'splitClip', payload: { clipId: dso.clip_id, beat: dso.split_at_beats } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'insert_device': {
            // Capture device count before adding so we can find the new one
            const track = state.tracks.find((time) => time.id === dso.track_id);
            const deviceCountBefore = track?.devices.length ?? 0;

            addDevice(dso.track_id, dso.device_type);

            // Track the newly inserted device ID for "latest" resolution
            const updatedState = trackStore.value;
            const updatedTrack = updatedState?.tracks.find((time) => time.id === dso.track_id);
            if (updatedTrack && updatedTrack.devices.length > deviceCountBefore) {
                const newDevice = updatedTrack.devices[updatedTrack.devices.length - 1];
                if (newDevice) {
                    context.lastInsertedDeviceId = newDevice.id;
                }
            }
            break;
        }

        case 'remove_device': {
            await executeAppAction({ type: 'removeDevice', payload: { deviceId: dso.device_id } }, DSO_EXEC_OPTIONS);
            break;
        }

        case 'bypass_device': {
            await executeAppAction(
                { type: 'bypassDevice', payload: { deviceId: dso.device_id, bypassed: dso.bypassed } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'set_tempo': {
            await executeAppAction(
                { type: 'setTempo', payload: { bpm: Math.max(20, Math.min(999, dso.bpm)) } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'set_time_signature': {
            const ts = transportStore.value;
            if (ts) {
                transportStore.set({
                    ...ts,
                    timeSignatureNumerator: Math.max(1, Math.min(32, dso.numerator)),
                    timeSignatureDenominator: Math.max(1, Math.min(32, dso.denominator)),
                });
            }
            break;
        }

        case 'set_loop': {
            if (dso.enabled) {
                setLoopRegion(dso.start_beats, dso.end_beats);
            } else {
                disableLooping();
            }
            break;
        }

        case 'set_device_param': {
            // Resolve "latest" to the tracked ID from the most recent insert_device in this plan
            const resolvedId = dso.device_id === 'latest' ? context.lastInsertedDeviceId : dso.device_id;
            if (!resolvedId) {
                break;
            }
            await executeAppAction(
                {
                    type: 'setDeviceParameter',
                    payload: { deviceId: resolvedId, paramId: dso.param_name, value: dso.value },
                },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'add_midi_notes': {
            const ms = midiStore.value;
            if (ms) {
                // Find the clip's start beat so we can offset relative note positions to absolute
                const clip = state.tracks.flatMap((time) => time.clips).find((context1) => context1.id === dso.clip_id);
                const clipStartBeat = clip?.startBeat ?? 0;

                const existing = ms.notesByClipId[dso.clip_id] ?? [];
                const newNotes = dso.notes.map(
                    (
                        node: { pitch: number; start_beat: number; duration: number; velocity: number },
                        index: number
                    ) => ({
                        id: `note-ai-${Date.now()}-${index}`,
                        pitch: Math.max(0, Math.min(127, node.pitch)),
                        startBeat: Math.max(0, clipStartBeat + node.start_beat),
                        duration: Math.max(0.01, node.duration),
                        velocity: Math.max(1, Math.min(127, node.velocity)),
                    })
                );
                midiStore.set({
                    ...ms,
                    notesByClipId: {
                        ...ms.notesByClipId,
                        [dso.clip_id]: [...existing, ...newNotes],
                    },
                });
            }
            break;
        }

        case 'set_clip_gain': {
            await executeAppAction(
                { type: 'setClipGain', payload: { clipId: dso.clip_id, gain: dso.gain } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'generate_melody': {
            const key = noteNameToMidi(dso.key);
            const scale = toScaleType(dso.scale);
            const style = toMelodyStyle(dso.style);
            applyMelodyToTrack(
                dso.track_id,
                { style, key, scale, octave: dso.octave, bars: dso.bars, density: dso.density },
                dso.start_beat ?? 0
            );
            break;
        }

        case 'generate_chords': {
            const key = noteNameToMidi(dso.key);
            const style = toChordStyle(dso.progression);
            const voicing = toChordVoicing(dso.voicing);
            applyChordProgressionToTrack(
                dso.track_id,
                { style, key, scale: 'major', bars: dso.bars, voicing },
                dso.start_beat ?? 0
            );
            break;
        }

        case 'generate_drums': {
            const style = toDrumStyle(dso.style);
            applyDrumPatternToTrack(dso.track_id, { style, bars: dso.bars, density: dso.density }, dso.start_beat ?? 0);
            break;
        }

        case 'transpose_notes': {
            await executeAppAction(
                { type: 'transposeNotes', payload: { clipId: dso.clip_id, semitones: dso.semitones } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'humanize_midi': {
            humanizeNotes(dso.clip_id, dso.timing_amount, dso.velocity_amount);
            break;
        }

        case 'create_send': {
            setSend(dso.from_track_id, dso.to_track_id, dso.gain);
            break;
        }
    }
}

/**
 * Execute a list of validated DSOs against the DAW stores.
 * Returns human-readable summaries of each applied operation.
 */
export async function executeDsos(dsos: Dso[]): Promise<string[]> {
    const context: DsoExecContext = { lastInsertedDeviceId: null };
    const summaries: string[] = [];

    for (const dso of dsos) {
        try {
            await executeSingleDso(dso, context);
            summaries.push(describeDso(dso));
        } catch (error) {
            logger.warn(`Failed to execute DSO ${dso.op}:`, error);
        }
    }

    return summaries;
}

// ── Human-readable summaries ─────────────────────────────────────────────────

function describeDso(dso: Dso): string {
    switch (dso.op) {
        case 'add_track':
            return `Added ${dso.kind} track "${dso.name}"`;
        case 'remove_track':
            return `Removed track`;
        case 'rename_track':
            return `Renamed track to "${dso.name}"`;
        case 'set_track_volume':
            return `Set volume to ${(dso.gain * 100).toFixed(0)}%`;
        case 'set_track_pan':
            return `Set pan to ${dso.pan}`;
        case 'mute_track':
            return dso.muted ? `Muted track` : `Unmuted track`;
        case 'solo_track':
            return dso.soloed ? `Soloed track` : `Unsoloed track`;
        case 'arm_track':
            return dso.armed ? `Armed track` : `Disarmed track`;
        case 'color_track':
            return `Colored track ${dso.color}`;
        case 'reorder_track':
            return `Moved track to position ${dso.new_index}`;
        case 'add_clip':
            return `Added ${dso.type} clip "${dso.name}" at beat ${dso.start_beats}`;
        case 'remove_clip':
            return `Removed clip`;
        case 'rename_clip':
            return `Renamed clip to "${dso.name}"`;
        case 'move_clip':
            return `Moved clip to beat ${dso.destination_start_beats}`;
        case 'duplicate_clip':
            return `Duplicated clip to beat ${dso.destination_start_beats}`;
        case 'split_clip':
            return `Split clip at beat ${dso.split_at_beats}`;
        case 'insert_device':
            return `Added ${dso.device_type}`;
        case 'remove_device':
            return `Removed device`;
        case 'bypass_device':
            return dso.bypassed ? `Bypassed device` : `Enabled device`;
        case 'set_tempo':
            return `Set tempo to ${dso.bpm} BPM`;
        case 'set_time_signature':
            return `Set time signature to ${dso.numerator}/${dso.denominator}`;
        case 'set_loop':
            return dso.enabled ? `Set loop ${dso.start_beats}–${dso.end_beats}` : `Disabled loop`;
        case 'transpose_notes':
            return `Transposed notes ${dso.semitones > 0 ? '+' : ''}${dso.semitones} semitones`;
        case 'humanize_midi':
            return `Humanized MIDI`;
        case 'create_send':
            return `Created send`;
        case 'set_device_param':
            return `Set ${dso.param_name} to ${dso.value}`;
        case 'add_midi_notes':
            return `Added ${dso.notes.length} MIDI note${dso.notes.length !== 1 ? 's' : ''}`;
        case 'set_clip_gain':
            return `Set clip gain to ${(dso.gain * 100).toFixed(0)}%`;
        case 'generate_melody':
            return `Generated ${dso.bars}-bar melody in ${dso.key} ${dso.scale}`;
        case 'generate_chords':
            return `Generated ${dso.bars}-bar ${dso.progression} chord progression in ${dso.key}`;
        case 'generate_drums':
            return `Generated ${dso.bars}-bar ${dso.style} drum pattern`;
        default:
            return `Unknown operation`;
    }
}
