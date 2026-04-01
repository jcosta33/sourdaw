/**
 * DSO Compiler — compiles Domain-Specific Operations into concrete DAW store mutations.
 *
 * Each DSO type maps to specific use case calls. Validation is performed
 * before execution. Human-readable summaries are generated for the action history.
 */
import { type Dso } from '../../models/DsoTypes';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { removeTrack } from '#/modules/Arrangement/useCases/removeTrack';
import { addClip } from '#/modules/Arrangement/useCases/clip/addClip';
import { addDevice } from '#/modules/Arrangement/useCases/device/addDevice';
import { type MelodyStyle, type ScaleType } from '#/modules/AiGeneration/useCases/generateMelody/algorithm';
import {
    type ChordProgressionStyle,
    type ChordVoicing,
} from '#/modules/AiGeneration/useCases/generateChordProgression/algorithm';
import { type DrumPatternStyle } from '#/modules/AiGeneration/useCases/generateDrumPattern/algorithm';

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

function toMelodyStyle(s: string): MelodyStyle {
    return MELODY_STYLE_MAP[s.toLowerCase()] ?? 'simple';
}

function toScaleType(s: string): ScaleType {
    return SCALE_MAP[s.toLowerCase()] ?? 'major';
}

function toChordStyle(s: string): ChordProgressionStyle {
    return CHORD_STYLE_MAP[s] ?? CHORD_STYLE_MAP[s.toLowerCase()] ?? 'pop';
}

function toChordVoicing(s: string): ChordVoicing {
    return CHORD_VOICING_MAP[s.toLowerCase()] ?? 'close';
}

function toDrumStyle(s: string): DrumPatternStyle {
    return DRUM_STYLE_MAP[s.toLowerCase()] ?? 'rock';
}

/**
 * Tracks the ID of the most recently inserted device within a single DSO plan execution.
 * When the LLM emits `device_id: "latest"`, this is resolved to this value.
 * Reset at the start of each `executeDsos()` call.
 */
let lastInsertedDeviceId: string | null = null;

// ── Name resolution ──────────────────────────────────────────────────────────
// The LLM outputs human-readable names (e.g. "Drums", "Vocal Clip").
// We resolve them to actual store IDs before validation and execution.

// ── Fuzzy name matching ──────────────────────────────────────────────────────

/**
 * Score how well `query` matches `candidate` (0 = no match, higher = better).
 * Handles typos, partial matches, and case differences.
 */
function fuzzyScore(query: string, candidate: string): number {
    const q = query.toLowerCase();
    const c = candidate.toLowerCase();

    // Exact match
    if (q === c) {
        return 100;
    }

    // Candidate contains query as substring
    if (c.includes(q)) {
        return 80;
    }

    // Query contains candidate
    if (q.includes(c)) {
        return 70;
    }

    // Token overlap (handles "drum bus" matching "Drum Bus Send")
    const qTokens = q.split(/[\s_-]+/);
    const cTokens = c.split(/[\s_-]+/);
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
    if (q.length <= 15 && c.length <= 20) {
        const dist = levenshtein(q, c);
        const maxLen = Math.max(q.length, c.length);
        const similarity = 1 - dist / maxLen;
        if (similarity > 0.6) {
            return similarity * 50;
        }
    }

    return 0;
}

function levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i]![j] =
                a[i - 1] === b[j - 1]
                    ? dp[i - 1]![j - 1]!
                    : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
        }
    }
    return dp[m]![n]!;
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
    const allClips = state.tracks.flatMap((t) => t.clips);
    const allDevices = state.tracks.flatMap((t) => t.devices);

    // Keep track of dynamically created tracks during this resolve pass
    const mockTracks: { id: string; name: string }[] = [];

    const findTrackId = (nameOrId: string): string | null => {
        if (state.tracks.some((t) => t.id === nameOrId)) return nameOrId;
        if (mockTracks.some((t) => t.id === nameOrId)) return nameOrId;
        
        let match = bestMatch(nameOrId, state.tracks, (t) => t.name);
        if (!match) match = bestMatch(nameOrId, mockTracks, (t) => t.name) as any;
        return match?.id ?? null;
    };

    const findClipId = (nameOrId: string): string | null => {
        if (allClips.some((c) => c.id === nameOrId)) {
            return nameOrId;
        }
        const match = bestMatch(nameOrId, allClips, (c) => c.name);
        return match?.id ?? null;
    };

    const findDeviceId = (nameOrId: string): string | null => {
        if (nameOrId === 'latest') {
            return 'latest';
        }
        if (allDevices.some((d) => d.id === nameOrId)) {
            return nameOrId;
        }
        const match = bestMatch(nameOrId, allDevices, (d) => d.type);
        return match?.id ?? null;
    };

    let i = 0;
    while (i < dsos.length) {
        const dso = dsos[i]!;

        // Resolve track_id fields
        if ('track_id' in dso && typeof dso.track_id === 'string') {
            const resolved = findTrackId(dso.track_id);
            if (resolved) {
                (dso as Record<string, unknown>).track_id = resolved;
            } else if (!['add_track'].includes(dso.op)) {
                // Fallback: auto-create this track
                const newId = `track-${crypto.randomUUID().slice(0, 8)}`;
                const kindFallback =
                    dso.op === 'generate_drums' || dso.track_id.toLowerCase().includes('drum') || dso.track_id.toLowerCase().includes('midi')
                        ? 'midi'
                        : 'audio';

                // Inject an `add_track` DSO before the current one
                dsos.splice(i, 0, {
                    op: 'add_track',
                    name: dso.track_id, // Use the unresolved name 
                    kind: kindFallback as any,
                    track_id: newId,
                } as any);

                mockTracks.push({ id: newId, name: dso.track_id });
                (dso as Record<string, unknown>).track_id = newId;

                // Advance to the current DSO we were just processing
                i++;
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

        i++;
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
    const trackIds = new Set(state?.tracks.map((t) => t.id) ?? []);
    const clipIds = new Set(state?.tracks.flatMap((t) => t.clips.map((c) => c.id)) ?? []);
    const deviceIds = new Set(state?.tracks.flatMap((t) => t.devices.map((d) => d.id)) ?? []);

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
                for (let i = 0; i < dso.notes.length; i++) {
                    const n = dso.notes[i]!;
                    if (n.pitch < 0 || n.pitch > 127) {
                        errors.push({ dso, reason: `Note ${i} pitch ${n.pitch} out of range (0-127)` });
                    }
                    if (n.velocity < 0 || n.velocity > 127) {
                        errors.push({ dso, reason: `Note ${i} velocity ${n.velocity} out of range (0-127)` });
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

/**
 * Execute a list of validated DSOs against the DAW stores.
 * Returns human-readable summaries of each applied operation.
 */
export function executeDsos(dsos: Dso[]): string[] {
    lastInsertedDeviceId = null;
    const summaries: string[] = [];

    for (const dso of dsos) {
        try {
            executeSingleDso(dso);
            summaries.push(describeDso(dso));
        } catch (error) {
            console.warn(`Failed to execute DSO ${dso.op}:`, error);
        }
    }

    return summaries;
}

function executeSingleDso(dso: Dso): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    switch (dso.op) {
        case 'add_track': {
            addTrack({ id: (dso as any).track_id, name: dso.name, kind: dso.kind as 'audio' | 'midi' | 'bus' | 'master' });
            break;
        }

        case 'remove_track': {
            removeTrack(dso.track_id);
            break;
        }

        case 'rename_track': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => (t.id === dso.track_id ? { ...t, name: dso.name } : t)),
            });
            break;
        }

        case 'set_track_volume': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => (t.id === dso.track_id ? { ...t, gain: dso.gain } : t)),
            });
            break;
        }

        case 'set_track_pan': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => (t.id === dso.track_id ? { ...t, pan: dso.pan } : t)),
            });
            break;
        }

        case 'mute_track': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => (t.id === dso.track_id ? { ...t, muted: dso.muted } : t)),
            });
            break;
        }

        case 'solo_track': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => (t.id === dso.track_id ? { ...t, soloed: dso.soloed } : t)),
            });
            break;
        }

        case 'arm_track': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => (t.id === dso.track_id ? { ...t, armed: dso.armed } : t)),
            });
            break;
        }

        case 'color_track': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => (t.id === dso.track_id ? { ...t, color: dso.color } : t)),
            });
            break;
        }

        case 'reorder_track': {
            const idx = state.tracks.findIndex((t) => t.id === dso.track_id);
            if (idx === -1) {
                break;
            }
            const tracks = [...state.tracks];
            const [removed] = tracks.splice(idx, 1);
            if (removed) {
                tracks.splice(Math.max(0, Math.min(tracks.length, dso.new_index)), 0, removed);
            }
            trackStore.set({ ...state, tracks });
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
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => ({
                    ...t,
                    clips: t.clips.filter((c) => c.id !== dso.clip_id),
                })),
            });
            break;
        }

        case 'rename_clip': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => ({
                    ...t,
                    clips: t.clips.map((c) => (c.id === dso.clip_id ? { ...c, name: dso.name } : c)),
                })),
            });
            break;
        }

        case 'move_clip': {
            // Find the clip, remove from old track, add to destination
            let movedClip: (typeof state.tracks)[0]['clips'][0] | undefined;
            const tracksWithout = state.tracks.map((t) => {
                const clip = t.clips.find((c) => c.id === dso.clip_id);
                if (clip) {
                    movedClip = clip;
                    return { ...t, clips: t.clips.filter((c) => c.id !== dso.clip_id) };
                }
                return t;
            });

            if (movedClip) {
                const duration = movedClip.endBeat - movedClip.startBeat;
                const updatedClip = {
                    ...movedClip,
                    startBeat: dso.destination_start_beats,
                    endBeat: dso.destination_start_beats + duration,
                };
                const tracksWithMoved = tracksWithout.map((t) => {
                    if (t.id === dso.destination_track_id) {
                        return { ...t, clips: [...t.clips, updatedClip] };
                    }
                    return t;
                });
                trackStore.set({ ...state, tracks: tracksWithMoved });
            }
            break;
        }

        case 'duplicate_clip': {
            const allClips = state.tracks.flatMap((t) => t.clips);
            const sourceClip = allClips.find((c) => c.id === dso.clip_id);
            if (sourceClip) {
                const duration = sourceClip.endBeat - sourceClip.startBeat;
                addClip({
                    trackId: dso.destination_track_id,
                    name: `${sourceClip.name} (copy)`,
                    type: (sourceClip.type as 'audio' | 'midi') ?? 'audio',
                    startBeat: dso.destination_start_beats,
                    endBeat: dso.destination_start_beats + duration,
                    audioBufferId: sourceClip.audioBufferId,
                });
            }
            break;
        }

        case 'split_clip': {
            // Find and split the clip at the given beat
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => {
                    const clip = t.clips.find((c) => c.id === dso.clip_id);
                    if (!clip || dso.split_at_beats <= clip.startBeat || dso.split_at_beats >= clip.endBeat) {
                        return t;
                    }
                    const left = { ...clip, endBeat: dso.split_at_beats };
                    const right = {
                        ...clip,
                        id: `${clip.id}-split-${Date.now()}`,
                        name: `${clip.name} (R)`,
                        startBeat: dso.split_at_beats,
                    };
                    return { ...t, clips: [...t.clips.filter((c) => c.id !== dso.clip_id), left, right] };
                }),
            });
            break;
        }

        case 'insert_device': {
            // Capture device count before adding so we can find the new one
            const track = state.tracks.find((t) => t.id === dso.track_id);
            const deviceCountBefore = track?.devices.length ?? 0;

            addDevice(dso.track_id, dso.device_type);

            // Track the newly inserted device ID for "latest" resolution
            const updatedState = trackStore.value;
            const updatedTrack = updatedState?.tracks.find((t) => t.id === dso.track_id);
            if (updatedTrack && updatedTrack.devices.length > deviceCountBefore) {
                const newDevice = updatedTrack.devices[updatedTrack.devices.length - 1];
                if (newDevice) {
                    lastInsertedDeviceId = newDevice.id;
                }
            }
            break;
        }

        case 'remove_device': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => {
                    if (t.id !== dso.track_id) {
                        return t;
                    }
                    return { ...t, devices: t.devices.filter((d) => d.id !== dso.device_id) };
                }),
            });
            break;
        }

        case 'bypass_device': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => ({
                    ...t,
                    devices: t.devices.map((d) => (d.id === dso.device_id ? { ...d, bypassed: dso.bypassed } : d)),
                })),
            });
            break;
        }

        case 'set_tempo': {
            const ts = transportStore.value;
            if (ts) {
                transportStore.set({ ...ts, tempo: Math.max(20, Math.min(999, dso.bpm)) });
            }
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
                void import('#/modules/Transport/useCases/transportControls/setLoopRegion').then(({ setLoopRegion }) =>
                    setLoopRegion(dso.start_beats, dso.end_beats)
                );
            } else {
                void import('#/modules/Transport/repositories/transport').then(({ updateTransportState }) =>
                    updateTransportState({ isLooping: false })
                );
            }
            break;
        }

        case 'set_device_param': {
            // Resolve "latest" to the tracked ID from the most recent insert_device in this plan
            const resolvedId = dso.device_id === 'latest' ? lastInsertedDeviceId : dso.device_id;
            if (!resolvedId) {
                break;
            }

            // Re-read state since insert_device may have mutated it
            const currentState = trackStore.value;
            if (!currentState) {
                break;
            }

            trackStore.set({
                ...currentState,
                tracks: currentState.tracks.map((t) => ({
                    ...t,
                    devices: t.devices.map((d) => {
                        if (d.id !== resolvedId) {
                            return d;
                        }
                        return {
                            ...d,
                            parameterValues: { ...(d.parameterValues ?? {}), [dso.param_name]: dso.value },
                        };
                    }),
                })),
            });
            break;
        }

        case 'add_midi_notes': {
            // Add MIDI notes to a clip via the MIDI store
            void import('#/modules/MIDI/stores/midiStore').then(({ midiStore }) => {
                const ms = midiStore.value;
                if (!ms) {
                    return;
                }
                const existing = ms.notesByClipId[dso.clip_id] ?? [];
                const newNotes = dso.notes.map((n, i) => ({
                    id: `note-ai-${Date.now()}-${i}`,
                    pitch: Math.max(0, Math.min(127, n.pitch)),
                    startBeat: Math.max(0, n.start_beat),
                    duration: Math.max(0.01, n.duration),
                    velocity: Math.max(1, Math.min(127, n.velocity)),
                }));
                midiStore.set({
                    ...ms,
                    notesByClipId: {
                        ...ms.notesByClipId,
                        [dso.clip_id]: [...existing, ...newNotes],
                    },
                });
            });
            break;
        }

        case 'set_clip_gain': {
            trackStore.set({
                ...state,
                tracks: state.tracks.map((t) => ({
                    ...t,
                    clips: t.clips.map((c) => (c.id === dso.clip_id ? { ...c, gain: dso.gain } : c)),
                })),
            });
            break;
        }

        case 'generate_melody': {
            const key = noteNameToMidi(dso.key);
            const scale = toScaleType(dso.scale);
            const style = toMelodyStyle(dso.style);
            void import('#/modules/AiGeneration/useCases/generateMelody/applyToTrack').then(
                ({ applyMelodyToTrack }) => {
                    applyMelodyToTrack(
                        dso.track_id,
                        {
                            style,
                            key,
                            scale,
                            octave: dso.octave,
                            bars: dso.bars,
                            density: dso.density,
                        },
                        dso.start_beat ?? 0
                    );
                }
            );
            break;
        }

        case 'generate_chords': {
            const key = noteNameToMidi(dso.key);
            const style = toChordStyle(dso.progression);
            const voicing = toChordVoicing(dso.voicing);
            void import('#/modules/AiGeneration/useCases/generateChordProgression/applyToTrack').then(
                ({ applyChordProgressionToTrack }) => {
                    applyChordProgressionToTrack(
                        dso.track_id,
                        {
                            style,
                            key,
                            scale: 'major',
                            bars: dso.bars,
                            voicing,
                        },
                        dso.start_beat ?? 0
                    );
                }
            );
            break;
        }

        case 'generate_drums': {
            const style = toDrumStyle(dso.style);
            void import('#/modules/AiGeneration/useCases/generateDrumPattern/applyToTrack').then(
                ({ applyDrumPatternToTrack }) => {
                    applyDrumPatternToTrack(
                        dso.track_id,
                        {
                            style,
                            bars: dso.bars,
                            density: dso.density,
                        },
                        dso.start_beat ?? 0
                    );
                }
            );
            break;
        }

        case 'transpose_notes': {
            void import('#/modules/MIDI/useCases/midiNoteTransforms/transposeNotes').then(({ transposeNotes }) =>
                transposeNotes(dso.clip_id, dso.semitones)
            );
            break;
        }

        case 'humanize_midi': {
            void import('#/modules/MIDI/useCases/midiNoteTransforms/humanizeNotes').then(({ humanizeNotes }) =>
                humanizeNotes(dso.clip_id, dso.timing_amount)
            );
            break;
        }

        case 'create_send': {
            void import('#/modules/Arrangement/useCases/device/sendManagement').then(({ setSend }) =>
                setSend(dso.from_track_id, dso.to_track_id, dso.gain)
            );
            break;
        }
    }
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
