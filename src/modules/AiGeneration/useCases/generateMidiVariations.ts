import { resolveBackend, streamCloudChatCompletion, generateWebLlmCompletion } from '#/modules/AiRuntime/useCases';
import { getTrackStoreState as getTrackState } from '#/modules/Arrangement/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { getNotesForClip } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createAiGenerationError } from '../errors/AiGenerationError';
import { readBalancedObject } from '../services/readBalancedObject';

// Consumer-local shape (AGENTS.md §95 — model isolation). Only the fields used here.
type Clip = {
    id: string;
    name: string;
    type: 'audio' | 'midi';
    startBeat: number;
    endBeat: number;
    midiOffsetBeats?: number;
    fadeInBeats?: number;
    fadeOutBeats?: number;
    gain?: number;
    color?: string;
    locked?: boolean;
    stretchMode?: 'off' | 'repitch' | 'timestretch';
    stretchRatio?: number;
    loopEnabled?: boolean;
    loopLength?: number;
    followAction?: 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';
    isGhost?: boolean;
};

// Consumer-local shape (model isolation) — field-identical to Arrangement's VariationNote.
type VariationNote = { pitch: number; startBeat: number; duration: number; velocity: number };

const VARIATIONS_SYSTEM_PROMPT =
    'You are a world-class generative MIDI AI. Generate musical variations as structured JSON only. No markdown, no explanation, no code blocks.';

type GenerateMidiVariationsOptions = {
    onToken?: (token: string) => void;
};

type PlannedVariation = {
    clipId: string;
    notes: VariationNote[];
};

function hasDurableVariations(planned: readonly PlannedVariation[]): boolean {
    const state = getTrackState();
    if (!state) {
        return false;
    }

    return planned.every((variation) => {
        const clipExists = state.tracks.some((track) => track.clips.some((clip) => clip.id === variation.clipId));
        if (!clipExists) {
            return false;
        }
        const expected = variation.notes
            .map(
                (note) =>
                    `${String(note.pitch)}:${String(note.startBeat)}:${String(note.duration)}:${String(note.velocity)}`
            )
            .sort();
        const written = getNotesForClip(variation.clipId)
            .map(
                (note) =>
                    `${String(note.pitch)}:${String(note.startBeat)}:${String(note.duration)}:${String(note.velocity)}`
            )
            .sort();
        return expected.length === written.length && expected.every((note, index) => note === written[index]);
    });
}

/**
 * Validate that an unknown value is a well-formed VariationNote array.
 * Each note must have finite, in-range pitch, startBeat, duration, and
 * velocity. NaN/Infinity, extra fields, empty arrays, and out-of-range MIDI
 * values are rejected before any AppAction is constructed.
 */
function isVariationNoteArray(arr: unknown): arr is VariationNote[] {
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > 256) {
        return false;
    }
    return arr.every((node) => {
        if (!isExactRecord(node, ['pitch', 'startBeat', 'duration', 'velocity'])) {
            return false;
        }
        const { pitch, startBeat, duration, velocity } = node;
        return (
            typeof pitch === 'number' &&
            Number.isInteger(pitch) &&
            pitch >= 0 &&
            pitch <= 127 &&
            typeof startBeat === 'number' &&
            Number.isFinite(startBeat) &&
            startBeat >= 0 &&
            typeof duration === 'number' &&
            Number.isFinite(duration) &&
            duration >= 0.0625 &&
            typeof velocity === 'number' &&
            Number.isInteger(velocity) &&
            velocity >= 1 &&
            velocity <= 127
        );
    });
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}

export async function generateMidiVariations(
    clipId: string,
    options: GenerateMidiVariationsOptions = {}
): Promise<number> {
    const { onToken } = options;

    const state = getTrackState();
    if (!state) {
        throw createAiGenerationError('Track state unavailable — cannot generate variations.');
    }

    let targetClip: Clip | null = null;
    let targetTrackId: string | null = null;
    for (const track of state.tracks) {
        const clip = track.clips.find((context) => context.id === clipId);
        if (clip) {
            targetClip = clip;
            targetTrackId = track.id;
            break;
        }
    }

    if (!targetClip || !targetTrackId || targetClip.type !== 'midi') {
        throw createAiGenerationError('Target clip must be a MIDI clip.');
    }

    const notes = getNotesForClip(targetClip.id);
    if (notes.length === 0) {
        throw createAiGenerationError('MIDI clip has no notes to vary.');
    }

    const duration = targetClip.endBeat - targetClip.startBeat;
    // Number.isFinite first: a bare `duration <= 0` lets NaN through (NaN <= 0 is
    // false), which would otherwise build a prompt advertising "length NaN beats".
    if (!Number.isFinite(duration) || duration <= 0) {
        throw createAiGenerationError('Clip has zero or negative duration — cannot generate variations.');
    }

    const projectRevision = captureProjectRevision();

    // Cap the note list so a long clip can't blow the LLM context window. We
    // describe the variation goal, not reproduce every note, so a representative
    // prefix plus a count of the remainder is enough for the model.
    const MAX_PROMPT_NOTES = 200;
    const promptNotes = notes.slice(0, MAX_PROMPT_NOTES);

    // Build a compact note representation relative to clip start for the LLM prompt
    const noteStrings = promptNotes
        .map(
            (node) =>
                `[pitch=${node.pitch}, start=${node.startBeat.toFixed(2)}, duration=${node.duration.toFixed(2)}, velocity=${node.velocity.toFixed(2)}]`
        )
        .join(', ');

    const omittedCount = notes.length - promptNotes.length;
    const omittedSuffix = omittedCount > 0 ? ` (+${String(omittedCount)} more notes omitted for brevity)` : '';

    const projectContext = `We have a MIDI clip of length ${String(duration)} beats. Current notes (relative to clip start): ${noteStrings}${omittedSuffix}`;

    const prompt = `Generate 3 completely unique musical variations of these MIDI notes. Keep the total length exactly ${String(duration)} beats. Keep them in the same key.
Return ONLY valid JSON matching this schema:
{ "variations": [ [ { "pitch": number, "startBeat": number, "duration": number, "velocity": number } ] ] }
Variation 1: Add syncopation and slight rhythm changes.
Variation 2: Add passing notes and embellishments.
Variation 3: Simplify the rhythm but keep the core harmonic rhythm.
ONLY output raw JSON, no markdown blocks.`;

    const userMessage = `${projectContext}\n\n${prompt}`;
    let responseStr = '';

    const backend = resolveBackend();

    if (backend === 'webllm') {
        responseStr = await generateWebLlmCompletion(VARIATIONS_SYSTEM_PROMPT, userMessage, { maxTokens: 4000 });
        onToken?.(responseStr);
    } else if (backend === 'cloud') {
        const outcome = await streamCloudChatCompletion(
            [
                { role: 'system', content: VARIATIONS_SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
            ],
            (token: string) => {
                responseStr += token;
                onToken?.(token);
            },
            { maxTokens: 4000 }
        );
        if (outcome.status === 'incomplete') {
            throw createAiGenerationError(`Hosted AI MIDI variations were incomplete (${outcome.reason}).`);
        }
    } else {
        throw createAiGenerationError(
            'No AI backend available. Configure a hosted provider in the desktop app or use Chrome with WebGPU.'
        );
    }

    // Extract JSON from the response — the model sometimes wraps output in markdown
    // fences and may emit several objects (e.g. a "thinking" preamble). Take the first
    // balanced-brace object that carries a "variations" key rather than a greedy
    // /\{[\s\S]*\}/, which over-captures across multiple objects into one blob.
    const jsonText = extractVariationsJsonObject(responseStr);
    if (jsonText === null) {
        throw createAiGenerationError('No JSON object found in AI response for variations.');
    }

    let variations: VariationNote[][];
    try {
        const parsed: unknown = JSON.parse(jsonText);
        if (!isExactRecord(parsed, ['variations'])) {
            throw new TypeError('Missing or invalid "variations" array in AI response');
        }
        const rawVariations = parsed.variations;
        if (
            !Array.isArray(rawVariations) ||
            rawVariations.length !== 3 ||
            !rawVariations.every(isVariationNoteArray) ||
            !rawVariations.every((variation) =>
                variation.every((note) => {
                    const noteEnd = note.startBeat + note.duration;
                    return Number.isFinite(noteEnd) && noteEnd <= duration;
                })
            )
        ) {
            throw new TypeError('Missing or invalid "variations" array in AI response');
        }
        variations = rawVariations;
    } catch (error) {
        throw createAiGenerationError(
            `Failed to parse variations from AI: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    const actions: AppAction[] = [];
    const plannedVariations: PlannedVariation[] = [];
    let variationStartBeat = targetClip.endBeat;
    for (const [index, variation] of variations.entries()) {
        const variationClipId = `clip-ai-${crypto.randomUUID()}`;
        plannedVariations.push({ clipId: variationClipId, notes: variation });
        actions.push(
            {
                type: 'addClip',
                payload: {
                    id: variationClipId,
                    trackId: targetTrackId,
                    startBeat: variationStartBeat,
                    endBeat: variationStartBeat + duration,
                    name: `${targetClip.name} (Var ${String(index + 1)})`,
                    type: 'midi',
                    midiOffsetBeats: targetClip.midiOffsetBeats,
                    fadeInBeats: targetClip.fadeInBeats,
                    fadeOutBeats: targetClip.fadeOutBeats,
                    gain: targetClip.gain,
                    color: targetClip.color,
                    locked: targetClip.locked,
                    muted: true,
                    stretchMode: targetClip.stretchMode,
                    stretchRatio: targetClip.stretchRatio,
                    loopEnabled: targetClip.loopEnabled,
                    loopLength: targetClip.loopLength,
                    followAction: targetClip.followAction,
                    isGhost: targetClip.isGhost,
                },
            },
            {
                type: 'addNotes',
                payload: { clipId: variationClipId, notes: variation },
            }
        );
        variationStartBeat += duration;
    }

    const result = await executeAppActionBatch(actions, {
        source: 'ai',
        groupId: `ai-variations-${crypto.randomUUID()}`,
        groupLabel: `AI Variations: ${clipId}`,
        requireCompensation: true,
        skipMacroRecording: true,
        shouldExecute: () => captureProjectRevision() === projectRevision,
    });
    if (result.status === 'committed-with-warning') {
        notifyUser(`MIDI variations committed with degraded history: ${result.warning}`, 'warning');
        return variations.length;
    }
    if (result.status === 'committed') {
        return variations.length;
    }
    if (result.status === 'ambiguous' && hasDurableVariations(plannedVariations)) {
        return variations.length;
    }
    if (result.status === 'cancelled' || result.status === 'conflicted') {
        throw createAiGenerationError(
            'The project changed while AI was generating variations. No variations were applied.'
        );
    }
    if (result.status === 'ambiguous') {
        throw createAiGenerationError('Variation commit outcome is unknown. Check the timeline before retrying.');
    }
    const reason = 'reason' in result ? result.reason : 'No variation actions were applied.';
    throw createAiGenerationError(`Failed to apply MIDI variations: ${reason}`);
}

/**
 * Find the first balanced-brace JSON object in `text` that contains a
 * "variations" key, or null if none. String literals (with escapes) are tracked
 * so braces inside strings don't skew the depth count.
 *
 * Preferred over a greedy /\{[\s\S]*\}/: when the model emits several objects
 * (e.g. a "thinking" preamble before the payload) the greedy form spans from the
 * first `{` to the last `}`, merging them into one un-parseable blob.
 */
function extractVariationsJsonObject(text: string): string | null {
    for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
        const candidate = readBalancedObject(text, start);
        if (candidate !== null && candidate.includes('"variations"')) {
            return candidate;
        }
    }
    return null;
}
