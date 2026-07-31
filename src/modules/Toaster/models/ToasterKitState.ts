import { createDefaultKit, type ToasterKit } from './ToasterKit';

/**
 * Wire version of the Toaster kit chunk. **Never renamed, never reused.** Bump this
 * only when the payload shape changes in a way an older reader would misread; a
 * reader that does not recognise the version falls back to the default kit rather
 * than guessing at the fields.
 *
 * Distinct from `ToasterKit.version`, which the preset format already carries: that
 * one describes a kit's own contents, this one describes the envelope the document
 * stores it in.
 */
export const TOASTER_KIT_STATE_VERSION = 1;

/**
 * JSON-shaped payload the document can store and merge. Mirrors the Arrangement
 * `DeviceStateValue` model structurally rather than importing it — models do not
 * cross module boundaries, and the chunk is opaque to the host by design.
 */
type ToasterKitStateValue =
    string | number | boolean | null | ToasterKitStateValue[] | { [key: string]: ToasterKitStateValue };

type ToasterKitStateChunk = {
    version: number;
    data: { [key: string]: ToasterKitStateValue };
};

/**
 * Serialise a live kit into the device-state chunk the document stores.
 *
 * The whole kit goes in, including the handful of numbers that are also automatable
 * parameters. That is what the native-host state extensions do — CLAP's persists
 * "both parameter values and non-parameter state" — and it keeps the chunk a
 * self-contained description of the device. `parameterValues` stays the automation
 * surface and is unaffected.
 */
export function toToasterKitState(kit: ToasterKit): ToasterKitStateChunk {
    return {
        version: TOASTER_KIT_STATE_VERSION,
        // Structured, not stringified: the document merges the subtree field by
        // field, so two peers editing different pads do not collide on the kit.
        data: { kit: JSON.parse(JSON.stringify(kit)) as { [key: string]: ToasterKitStateValue } },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function readPads(value: unknown, fallback: ToasterKit): ToasterKit['pads'] {
    if (!Array.isArray(value)) {
        return fallback.pads;
    }
    return fallback.pads.map((defaultPad, index) => {
        const stored: unknown = value[index];
        if (!isRecord(stored)) {
            return defaultPad;
        }
        const pad = { ...defaultPad };
        if (typeof stored.name === 'string') {
            pad.name = stored.name;
        }
        if (typeof stored.color === 'string') {
            pad.color = stored.color;
        }
        if (typeof stored.engineType === 'string') {
            // The engine union is validated downstream by the engine map, which falls
            // back for an unknown id. Keeping the string here lets a kit written by a
            // newer build round-trip through an older one without losing the pad.
            pad.engineType = stored.engineType as ToasterKit['pads'][number]['engineType'];
        }
        if (typeof stored.muted === 'boolean') {
            pad.muted = stored.muted;
        }
        if (typeof stored.soloed === 'boolean') {
            pad.soloed = stored.soloed;
        }
        for (const key of [
            'chokeGroup',
            'midiNote',
            'volume',
            'pan',
            'tune',
            'decay',
            'tone',
            'drive',
            'filterCutoff',
            'filterResonance',
            'sendReverb',
            'sendDelay',
        ] as const) {
            const stored_value = stored[key];
            if (isFiniteNumber(stored_value)) {
                pad[key] = stored_value;
            }
        }
        if (isRecord(stored.engineParams)) {
            const engineParams: Record<string, number> = {};
            for (const [key, entry] of Object.entries(stored.engineParams)) {
                if (isFiniteNumber(entry)) {
                    engineParams[key] = entry;
                }
            }
            pad.engineParams = engineParams;
        }
        return pad;
    });
}

function readSteps(value: unknown, fallback: ToasterKit['patterns'][number]['tracks'][number]['steps']) {
    if (!Array.isArray(value)) {
        return fallback;
    }
    return value.map((stored: unknown, index: number) => {
        const defaultStep = fallback[index] ?? fallback[0];
        const step = { ...defaultStep } as ToasterKit['patterns'][number]['tracks'][number]['steps'][number];
        if (!isRecord(stored)) {
            return step;
        }
        if (typeof stored.active === 'boolean') {
            step.active = stored.active;
        }
        if (typeof stored.condition === 'string') {
            step.condition = stored.condition as typeof step.condition;
        }
        if (typeof stored.soundLock === 'string') {
            step.soundLock = stored.soundLock as typeof step.soundLock;
        }
        for (const key of ['velocity', 'probability', 'microTiming', 'retriggerCount'] as const) {
            const stored_value = stored[key];
            if (isFiniteNumber(stored_value)) {
                step[key] = stored_value;
            }
        }
        if (isRecord(stored.paramLocks)) {
            const paramLocks: Record<string, number> = {};
            for (const [key, entry] of Object.entries(stored.paramLocks)) {
                if (isFiniteNumber(entry)) {
                    paramLocks[key] = entry;
                }
            }
            step.paramLocks = paramLocks;
        }
        return step;
    });
}

function readPatterns(value: unknown, fallback: ToasterKit): ToasterKit['patterns'] {
    if (!Array.isArray(value) || value.length === 0) {
        return fallback.patterns;
    }
    const defaultPattern = fallback.patterns[0];
    if (!defaultPattern) {
        return fallback.patterns;
    }

    const patterns = value.filter(isRecord).map((stored) => {
        const pattern = { ...defaultPattern };
        if (typeof stored.id === 'string') {
            pattern.id = stored.id;
        }
        if (typeof stored.name === 'string') {
            pattern.name = stored.name;
        }
        if (isFiniteNumber(stored.stepsPerBar)) {
            pattern.stepsPerBar = stored.stepsPerBar;
        }
        if (isFiniteNumber(stored.bars)) {
            pattern.bars = stored.bars;
        }
        const storedTracks = stored.tracks;
        if (Array.isArray(storedTracks)) {
            pattern.tracks = defaultPattern.tracks.map((defaultTrack, index) => {
                const storedTrack: unknown = storedTracks[index];
                if (!isRecord(storedTrack)) {
                    return defaultTrack;
                }
                const track = { ...defaultTrack, steps: readSteps(storedTrack.steps, defaultTrack.steps) };
                if (isFiniteNumber(storedTrack.stepsOverride)) {
                    track.stepsOverride = storedTrack.stepsOverride;
                }
                return track;
            });
        }
        return pattern;
    });

    if (patterns.length === 0) {
        return fallback.patterns;
    }
    return patterns;
}

/**
 * Rebuild a kit from a stored device-state chunk, degrading to the default kit
 * rather than failing.
 *
 * Every level falls back independently: an unrecognised version yields the whole
 * default kit, a malformed `pads` entry yields that one default pad, a malformed
 * step yields that one default step. Nothing here throws and nothing returns a
 * partial kit — the caller always gets a structurally complete `ToasterKit`, because
 * the sequencer, the engine projection and the panel all index into it directly and
 * a missing pad or pattern would be a crash rather than a degraded sound.
 */
export function fromToasterKitState(chunk: unknown): ToasterKit {
    const fallback = createDefaultKit();
    if (!isRecord(chunk) || chunk.version !== TOASTER_KIT_STATE_VERSION) {
        return fallback;
    }
    if (!isRecord(chunk.data) || !isRecord(chunk.data.kit)) {
        return fallback;
    }

    const stored = chunk.data.kit;
    const kit: ToasterKit = {
        ...fallback,
        pads: readPads(stored.pads, fallback),
        patterns: readPatterns(stored.patterns, fallback),
    };

    if (typeof stored.name === 'string') {
        kit.name = stored.name;
    }
    if (isFiniteNumber(stored.version)) {
        kit.version = stored.version;
    }
    for (const key of [
        'swing',
        'masterGain',
        'reverbMix',
        'reverbDecay',
        'delayTime',
        'delayFeedback',
        'delayMix',
        'lofiBits',
        'lofiRate',
        'lofiMix',
    ] as const) {
        const stored_value = stored[key];
        if (isFiniteNumber(stored_value)) {
            kit[key] = stored_value;
        }
    }
    if (Array.isArray(stored.macros) && stored.macros.length === kit.macros.length) {
        const macros = stored.macros.map((entry, index) => (isFiniteNumber(entry) ? entry : kit.macros[index]));
        kit.macros = macros as ToasterKit['macros'];
    }

    // Resolved last, and only against patterns that actually survived: a stored id
    // pointing at a pattern the fallback rebuilt would leave the sequencer and the
    // exporter reading a pattern that is not there.
    if (typeof stored.activePatternId === 'string' && kit.patterns.some((p) => p.id === stored.activePatternId)) {
        kit.activePatternId = stored.activePatternId;
    } else {
        kit.activePatternId = kit.patterns[0]?.id ?? fallback.activePatternId;
    }

    return kit;
}
