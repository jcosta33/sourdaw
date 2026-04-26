import {
    resolveBackend,
    streamCloudChatCompletion,
    generateNativeCompletion,
    generateWebLlmCompletion,
    isNativeEngineReady,
} from '#/modules/AiRuntime/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import { createAlternativeClips, getTrackStoreState as getTrackState } from '#/modules/Arrangement/useCases';
import { type VariationNote } from '#/modules/Arrangement/useCases';
import { pushUndoEntry } from '#/modules/Command/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { getNotesForClip } from '#/modules/MIDI/useCases';

import { createAiGenerationError } from '../errors/AiGenerationError';

// Consumer-local shape (AGENTS.md §95 — model isolation). Only the fields used here.
type Clip = { id: string; type: 'audio' | 'midi'; startBeat: number; endBeat: number };

const VARIATIONS_SYSTEM_PROMPT =
    'You are a world-class generative MIDI AI. Generate musical variations as structured JSON only. No markdown, no explanation, no code blocks.';

type GenerateMidiVariationsOptions = {
    onToken?: (token: string) => void;
};

/**
 * Validate that an unknown value is a well-formed VariationNote array.
 * Each note must have numeric pitch, startBeat, duration, and velocity.
 */
function isVariationNoteArray(arr: unknown): arr is VariationNote[] {
    if (!Array.isArray(arr)) {
        return false;
    }
    return arr.every(
        (node) =>
            typeof node === 'object' &&
            node !== null &&
            typeof (node as Record<string, unknown>).pitch === 'number' &&
            typeof (node as Record<string, unknown>).startBeat === 'number' &&
            typeof (node as Record<string, unknown>).duration === 'number' &&
            typeof (node as Record<string, unknown>).velocity === 'number'
    );
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
    if (!notes || notes.length === 0) {
        throw createAiGenerationError('MIDI clip has no notes to vary.');
    }

    const duration = targetClip.endBeat - targetClip.startBeat;
    if (duration <= 0) {
        throw createAiGenerationError('Clip has zero or negative duration — cannot generate variations.');
    }

    const startBeat = targetClip.startBeat;

    // Build a compact note representation relative to clip start for the LLM prompt
    const noteStrings = notes
        .map(
            (node) =>
                `[pitch=${node.pitch}, start=${(node.startBeat - startBeat).toFixed(2)}, duration=${node.duration.toFixed(2)}, velocity=${node.velocity.toFixed(2)}]`
        )
        .join(', ');

    const projectContext = `We have a MIDI clip of length ${String(duration)} beats. Current notes (relative to clip start): ${noteStrings}`;

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
        await streamCloudChatCompletion(
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
    } else {
        throw createAiGenerationError(
            'No AI backend available. Configure a cloud API key in Settings → AI, or use Chrome with WebGPU for the browser AI engine.'
        );
    }

    // Extract JSON from the response — the model sometimes wraps output in markdown fences
    const jsonMatch = responseStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw createAiGenerationError('No JSON object found in AI response for variations.');
    }

    let variations: VariationNote[][];
    try {
        const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        if (!data || !Array.isArray(data.variations)) {
            throw new Error('Missing or invalid "variations" array in AI response');
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
    const trackSnapshotBefore = trackStore.value;
    const midiSnapshotBefore = midiStore.value;

    createAlternativeClips(targetClip.id, variations);

    const trackSnapshotAfter = trackStore.value;
    const midiSnapshotAfter = midiStore.value;

    pushUndoEntry(
        `AI Variations: ${clipId}`,
        () => {
            if (trackSnapshotBefore) {
                trackStore.set(trackSnapshotBefore);
            }
            if (midiSnapshotBefore) {
                midiStore.set(midiSnapshotBefore);
            }
        },
        () => {
            if (trackSnapshotAfter) {
                trackStore.set(trackSnapshotAfter);
            }
            if (midiSnapshotAfter) {
                midiStore.set(midiSnapshotAfter);
            }
        },
        { source: 'ai' }
    );
    return variations.length;
}
