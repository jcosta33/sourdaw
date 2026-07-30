/**
 * Execute validated Domain-Specific Operations through the typed AppAction
 * boundary and report applied summaries alongside per-operation failures.
 */
import { logger } from '#/infra/logger/appLogger';
import { trackStore } from '#/modules/Arrangement/stores';
import { executeAppAction } from '#/modules/Command/useCases';

import { type Dso } from '../../models/DsoTypes';

import { validateDsoTimeSignature } from './services/validateDsoTimeSignature';

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
    const resolved = NOTE_NAME_TO_MIDI[name] ?? NOTE_NAME_TO_MIDI[name.charAt(0).toUpperCase() + name.slice(1)];
    if (resolved === undefined) {
        logger.warn(`DSO: unknown note name "${name}", defaulting to middle C (MIDI 60).`);
        return 60;
    }
    return resolved;
}

// Record-based lookups — values are typed literals, keys are strings the LLM might produce.
// No casts needed: the Record values ARE the correct types.
type MelodyStyle = 'simple' | 'arpeggiated' | 'stepwise' | 'rhythmic' | 'ambient';

type ScaleType =
    | 'major'
    | 'minor'
    | 'pentatonic'
    | 'minor-pentatonic'
    | 'blues'
    | 'dorian'
    | 'mixolydian'
    | 'lydian'
    | 'phrygian'
    | 'locrian'
    | 'harmonic-minor'
    | 'melodic-minor'
    | 'whole-tone'
    | 'chromatic';

type ChordProgressionStyle =
    | 'pop'
    | 'jazz'
    | 'classical'
    | 'edm'
    | 'blues'
    | 'rnb'
    | 'folk'
    | 'cinematic'
    | 'neo-soul'
    | 'gospel'
    | 'rock'
    | 'lofi';

type ChordVoicing = 'close' | 'open' | 'spread' | 'power';

type DrumPatternStyle =
    | 'four-on-floor'
    | 'breakbeat'
    | 'trap'
    | 'jazz'
    | 'latin'
    | 'rock'
    | 'dnb'
    | 'half-time'
    | 'blues'
    | 'reggae'
    | 'lofi'
    | 'house'
    | 'techno'
    | 'synthwave'
    | 'afrobeat'
    | 'metal'
    | 'punk';

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
    const resolved = MELODY_STYLE_MAP[state.toLowerCase()];
    if (resolved === undefined) {
        logger.warn(`DSO: unknown melody style "${state}", defaulting to "simple".`);
        return 'simple';
    }
    return resolved;
}

function toScaleType(state: string): ScaleType {
    const resolved = SCALE_MAP[state.toLowerCase()];
    if (resolved === undefined) {
        logger.warn(`DSO: unknown scale type "${state}", defaulting to "major".`);
        return 'major';
    }
    return resolved;
}

function toChordStyle(state: string): ChordProgressionStyle {
    const resolved = CHORD_STYLE_MAP[state] ?? CHORD_STYLE_MAP[state.toLowerCase()];
    if (resolved === undefined) {
        logger.warn(`DSO: unknown chord progression style "${state}", defaulting to "pop".`);
        return 'pop';
    }
    return resolved;
}

function toChordVoicing(state: string): ChordVoicing {
    const resolved = CHORD_VOICING_MAP[state.toLowerCase()];
    if (resolved === undefined) {
        logger.warn(`DSO: unknown chord voicing "${state}", defaulting to "close".`);
        return 'close';
    }
    return resolved;
}

function toDrumStyle(state: string): DrumPatternStyle {
    const resolved = DRUM_STYLE_MAP[state.toLowerCase()];
    if (resolved === undefined) {
        logger.warn(`DSO: unknown drum style "${state}", defaulting to "rock".`);
        return 'rock';
    }
    return resolved;
}

/**
 * Per-execution context for a single `executeDsos()` call.
 * Tracks the ID of the most recently inserted device so that the LLM's
 * The `device_id: "latest"` sentinel can be resolved to a concrete ID.
 *
 * Held in a local variable inside `executeDsos()` rather than at module
 * scope so concurrent plan executions (e.g. an AI chat response that
 * triggers while a prior AI edit is still mid-execution) cannot clobber
 * each other's in-flight device references.
 */
type DsoExecContext = {
    lastInsertedDeviceId: string | null;
    executeOptions: {
        skipUndo: true;
        source: 'ai';
        snapshotTransaction?: object;
    };
};

// ── Compilation (execution) ──────────────────────────────────────────────────

async function executeSingleDso(dso: Dso, context: DsoExecContext): Promise<void> {
    // The batch transaction handle is local to this execution, so concurrent
    // plans cannot overwrite one another's action-write ownership.
    const DSO_EXEC_OPTIONS = context.executeOptions;
    const state = trackStore.value;
    if (!state) {
        return;
    }

    switch (dso.op) {
        case 'add_track': {
            await executeAppAction(
                {
                    type: 'addTrack',
                    payload: { id: dso.track_id, name: dso.name, kind: dso.kind },
                },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'remove_track': {
            await executeAppAction({ type: 'removeTrack', payload: { trackId: dso.track_id } }, DSO_EXEC_OPTIONS);
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
            await executeAppAction(
                {
                    type: 'addClip',
                    payload: {
                        trackId: dso.track_id,
                        name: dso.name,
                        type: dso.type,
                        startBeat: dso.start_beats,
                        endBeat: dso.end_beats,
                    },
                },
                DSO_EXEC_OPTIONS
            );
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
                await executeAppAction(
                    {
                        type: 'addClip',
                        payload: {
                            trackId: dso.destination_track_id,
                            name: `${sourceClip.name} (copy)`,
                            type: sourceClip.type ?? 'audio',
                            startBeat: dso.destination_start_beats,
                            endBeat: dso.destination_start_beats + duration,
                            audioBufferId: sourceClip.audioBufferId,
                        },
                    },
                    DSO_EXEC_OPTIONS
                );
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

            await executeAppAction(
                { type: 'addDevice', payload: { trackId: dso.track_id, deviceType: dso.device_type } },
                DSO_EXEC_OPTIONS
            );

            // Track the newly inserted device ID for `latest` resolution
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
            // No clamp here: validation already rejects bpm outside [20, 999]
            // before execution, so dso.bpm is in range by the time we reach this.
            await executeAppAction({ type: 'setTempo', payload: { bpm: dso.bpm } }, DSO_EXEC_OPTIONS);
            break;
        }

        case 'set_time_signature': {
            const reason = validateDsoTimeSignature({
                numerator: dso.numerator,
                denominator: dso.denominator,
            });
            if (reason) {
                throw new Error(reason);
            }
            await executeAppAction(
                { type: 'setTimeSignature', payload: { numerator: dso.numerator, denominator: dso.denominator } },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'set_loop': {
            if (dso.enabled) {
                await executeAppAction(
                    { type: 'setLoopRegion', payload: { startBeat: dso.start_beats, endBeat: dso.end_beats } },
                    DSO_EXEC_OPTIONS
                );
            }
            await executeAppAction({ type: 'setLoopEnabled', payload: { enabled: dso.enabled } }, DSO_EXEC_OPTIONS);
            break;
        }

        case 'set_device_param': {
            // Resolve `latest` to the tracked ID from the most recent insert_device in this plan
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
            const clip = state.tracks.flatMap((time) => time.clips).find((context1) => context1.id === dso.clip_id);
            const clipStartBeat = clip?.startBeat ?? 0;

            await executeAppAction(
                {
                    type: 'addNotes',
                    payload: {
                        clipId: dso.clip_id,
                        notes: dso.notes.map((node) => ({
                            pitch: Math.max(0, Math.min(127, node.pitch)),
                            startBeat: Math.max(0, clipStartBeat + node.start_beat),
                            duration: Math.max(0.01, node.duration),
                            velocity: Math.max(1, Math.min(127, node.velocity)),
                        })),
                    },
                },
                DSO_EXEC_OPTIONS
            );
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
            // Dispatch the registered `generateMelody` action so AiGeneration's
            // handler owns the apply path — execution stays free of a static
            // edge into AiGeneration/useCases.
            await executeAppAction(
                {
                    type: 'generateMelody',
                    payload: {
                        trackId: dso.track_id,
                        style: toMelodyStyle(dso.style),
                        key: noteNameToMidi(dso.key),
                        scale: toScaleType(dso.scale),
                        octave: dso.octave,
                        bars: dso.bars,
                        density: dso.density,
                        startBeat: dso.start_beat ?? 0,
                    },
                },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'generate_chords': {
            await executeAppAction(
                {
                    type: 'generateChordProgression',
                    payload: {
                        trackId: dso.track_id,
                        style: toChordStyle(dso.progression),
                        key: noteNameToMidi(dso.key),
                        scale: 'major',
                        bars: dso.bars,
                        voicing: toChordVoicing(dso.voicing),
                        startBeat: dso.start_beat ?? 0,
                    },
                },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'generate_drums': {
            await executeAppAction(
                {
                    type: 'generateDrumPattern',
                    payload: {
                        trackId: dso.track_id,
                        style: toDrumStyle(dso.style),
                        bars: dso.bars,
                        density: dso.density,
                        startBeat: dso.start_beat ?? 0,
                    },
                },
                DSO_EXEC_OPTIONS
            );
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
            await executeAppAction(
                {
                    type: 'humanizeNotes',
                    payload: { clipId: dso.clip_id, amount: dso.timing_amount, velocityAmount: dso.velocity_amount },
                },
                DSO_EXEC_OPTIONS
            );
            break;
        }

        case 'create_send': {
            await executeAppAction(
                {
                    type: 'setSend',
                    payload: { trackId: dso.from_track_id, busId: dso.to_track_id, level: dso.gain },
                },
                DSO_EXEC_OPTIONS
            );
            break;
        }
    }
}

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

type ExecuteDsosOutput = Promise<{
    summaries: string[];
    failures: Array<{ op: Dso['op']; reason: string }>;
}>;

/**
 * Execute a list of validated DSOs against the DAW stores.
 * Returns human-readable summaries of each applied operation alongside the
 * failures of any DSO that threw — callers must surface failures rather than
 * report unconditional success.
 */
export async function executeDsos(dsos: Dso[], snapshotTransaction?: object): ExecuteDsosOutput {
    const context: DsoExecContext = {
        lastInsertedDeviceId: null,
        executeOptions: {
            skipUndo: true,
            source: 'ai',
            snapshotTransaction,
        },
    };
    const summaries: string[] = [];
    const failures: Array<{ op: Dso['op']; reason: string }> = [];

    for (const dso of dsos) {
        try {
            await executeSingleDso(dso, context);
            summaries.push(describeDso(dso));
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            logger.warn(`Failed to execute DSO ${dso.op}:`, error);
            failures.push({ op: dso.op, reason });
        }
    }

    return { summaries, failures };
}
