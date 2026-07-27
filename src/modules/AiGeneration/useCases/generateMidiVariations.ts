import {
    resolveBackend,
    streamCloudChatCompletion,
    generateNativeCompletion,
    generateWebLlmCompletion,
    isNativeEngineReady,
} from '#/modules/AiRuntime/useCases';
import {
    createAlternativeClips,
    getTrackStoreState as getTrackState,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { pushUndoEntry } from '#/modules/Command/useCases';
import { getMidiStoreState as getMidiState, getNotesForClip, setMidiStoreState } from '#/modules/MIDI/useCases';

import { createAiGenerationError } from '../errors/AiGenerationError';
import { readBalancedObject } from '../services/readBalancedObject';

// Consumer-local shape (AGENTS.md §95 — model isolation). Only the fields used here.
type Clip = { id: string; type: 'audio' | 'midi'; startBeat: number; endBeat: number };

// Consumer-local shape (model isolation) — field-identical to Arrangement's VariationNote.
type VariationNote = { pitch: number; startBeat: number; duration: number; velocity: number };

const VARIATIONS_SYSTEM_PROMPT =
    'You are a world-class generative MIDI AI. Generate musical variations as structured JSON only. No markdown, no explanation, no code blocks.';

type GenerateMidiVariationsOptions = {
    onToken?: (token: string) => void;
};

/**
 * Validate that an unknown value is a well-formed VariationNote array.
 * Each note must have finite, in-range pitch, startBeat, duration, and
 * velocity. NaN/Infinity and out-of-range MIDI values are rejected so they
 * never reach createAlternativeClips. (A bare typeof check passes for NaN.)
 */
function isVariationNoteArray(arr: unknown): arr is VariationNote[] {
    if (!Array.isArray(arr)) {
        return false;
    }
    return arr.every((node) => {
        if (typeof node !== 'object' || node === null) {
            return false;
        }
        const record = node as Record<string, unknown>;
        const { pitch, startBeat, duration, velocity } = record;
        return (
            typeof pitch === 'number' &&
            Number.isFinite(pitch) &&
            pitch >= 0 &&
            pitch <= 127 &&
            typeof startBeat === 'number' &&
            Number.isFinite(startBeat) &&
            startBeat >= 0 &&
            typeof duration === 'number' &&
            Number.isFinite(duration) &&
            duration > 0 &&
            typeof velocity === 'number' &&
            Number.isFinite(velocity) &&
            velocity >= 1 &&
            velocity <= 127
        );
    });
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
    for (const track of state.tracks) {
        const clip = track.clips.find((context) => context.id === clipId);
        if (clip) {
            targetClip = clip;
            break;
        }
    }

    if (!targetClip || targetClip.type !== 'midi') {
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

    const startBeat = targetClip.startBeat;

    // Cap the note list so a long clip can't blow the LLM context window. We
    // describe the variation goal, not reproduce every note, so a representative
    // prefix plus a count of the remainder is enough for the model.
    const MAX_PROMPT_NOTES = 200;
    const promptNotes = notes.slice(0, MAX_PROMPT_NOTES);

    // Build a compact note representation relative to clip start for the LLM prompt
    const noteStrings = promptNotes
        .map(
            (node) =>
                `[pitch=${node.pitch}, start=${(node.startBeat - startBeat).toFixed(2)}, duration=${node.duration.toFixed(2)}, velocity=${node.velocity.toFixed(2)}]`
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

    if (backend === 'native' && isNativeEngineReady()) {
        responseStr = await generateNativeCompletion(VARIATIONS_SYSTEM_PROMPT, userMessage, { maxTokens: 4000 });
        // Native returns the full string at once — fire the callback once so callers can react
        onToken?.(responseStr);
    } else if (backend === 'webllm') {
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
            'No AI backend available. Configure a cloud API key in Settings → AI, or use Chrome with WebGPU for the browser AI engine.'
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
        if (typeof parsed !== 'object' || parsed === null) {
            throw new TypeError('Missing or invalid "variations" array in AI response');
        }
        const data = parsed as Record<string, unknown>;
        if (!Array.isArray(data.variations)) {
            throw new TypeError('Missing or invalid "variations" array in AI response');
        }
        // Filter out any variation entries that don't match the expected note shape
        variations = (data.variations as unknown[]).filter(isVariationNoteArray);
        if (variations.length === 0) {
            throw new Error('AI response contained no valid variation note arrays');
        }
    } catch (error) {
        throw createAiGenerationError(
            `Failed to parse variations from AI: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    // Snapshot both stores before mutation so the undo entry can restore them
    const trackSnapshotBefore = getTrackState();
    const midiSnapshotBefore = getMidiState();

    createAlternativeClips(targetClip.id, variations);

    const trackSnapshotAfter = getTrackState();
    const midiSnapshotAfter = getMidiState();

    pushUndoEntry(
        `AI Variations: ${clipId}`,
        () => {
            if (trackSnapshotBefore) {
                setTrackStoreState(trackSnapshotBefore);
            }
            if (midiSnapshotBefore) {
                setMidiStoreState(midiSnapshotBefore);
            }
        },
        () => {
            if (trackSnapshotAfter) {
                setTrackStoreState(trackSnapshotAfter);
            }
            if (midiSnapshotAfter) {
                setMidiStoreState(midiSnapshotAfter);
            }
        },
        { source: 'ai' }
    );
    return variations.length;
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
