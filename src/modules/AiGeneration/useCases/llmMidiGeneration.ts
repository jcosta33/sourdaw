/**
 * Use case: LLM-powered MIDI generation.
 *
 * Routes MIDI generation through the WebLLM pipeline with a music-specific
 * system prompt that produces structured JSON note arrays.
 * Falls back to pattern-based generation if LLM output is malformed.
 */

import { resolveBackend } from '#/modules/AiRuntime/useCases/llmOrchestration';
import { generateWebLlmCompletion } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { generateNativeCompletion } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { isLlamaServerRunning } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';
import { type GeneratedNote } from '#/modules/AudioEngine/repositories/nativeAIBridge';
import { PATTERN_TEMPLATES, filterTemplates } from '#/modules/AiRuntime/useCases/aiRuntimeQueries';

// ── System prompt for music generation ──

const MIDI_SYSTEM_PROMPT = `You are a music composition assistant embedded in a digital audio workstation.
Your job is to generate MIDI note data as structured JSON.

RULES:
- Output ONLY valid JSON. No markdown, no explanation, no text before or after.
- Format: {"notes":[{"pitch":60,"velocity":80,"start_beat":0,"duration_beats":0.5},...]}
- pitch: MIDI note number (0-127). Middle C = 60. Use standard note ranges.
- velocity: 1-127 (loudness). Typical range 60-100.
- start_beat: when the note starts, in beats (1 beat = 1 quarter note). Can be fractional (0.25 = 16th note).
- duration_beats: how long the note lasts in beats. Can be fractional.
- Keep patterns musically coherent. Use proper scales and chord voicings.
- For drums: use General MIDI drum map (kick=36, snare=38, closed_hh=42, open_hh=46, clap=39, ride=51, crash=49).
- Generate between 8 and 64 notes unless instructed otherwise.
- Start beats from 0.

Examples of valid output:
{"notes":[{"pitch":60,"velocity":80,"start_beat":0,"duration_beats":1},{"pitch":64,"velocity":75,"start_beat":1,"duration_beats":1}]}`;

// ── Types ──

type LlmMidiResponse = {
    notes: Array<{
        pitch: number;
        velocity: number;
        start_beat: number;
        duration_beats: number;
    }>;
};

// ── Core generation ──

/**
 * Generate MIDI notes using the LLM (WebLLM in browser or native mistral.rs).
 * Returns GeneratedNote[] compatible with the existing clip insertion pipeline.
 */
export async function generateMidiViaLlm(
    prompt: string,
    numNotes: number = 32,
    creativity: number = 0.65
): Promise<GeneratedNote[]> {
    const userMessage = buildUserMessage(prompt, numNotes, creativity);

    const backend = resolveBackend();
    let rawResponse: string;

    if (backend === 'none') {
        return fallbackToPatternMatch(prompt);
    }

    if (backend === 'native' && isLlamaServerRunning()) {
        rawResponse = await generateNativeCompletion(MIDI_SYSTEM_PROMPT, userMessage);
    } else if (backend === 'cloud') {
        // Cloud fallback: use the same MIDI prompt but via native completion
        // (Cloud tool-calling is better suited for DAW actions, not raw JSON MIDI)
        return fallbackToPatternMatch(prompt);
    } else {
        rawResponse = await generateWebLlmCompletion(MIDI_SYSTEM_PROMPT, userMessage);
    }

    const notes = parseMidiResponse(rawResponse);

    if (notes.length === 0) {
        return fallbackToPatternMatch(prompt);
    }

    return notes;
}

// ── Helpers ──

function buildUserMessage(prompt: string, numNotes: number, creativity: number): string {
    const creativityDesc =
        creativity < 0.3
            ? 'very predictable and conventional'
            : creativity < 0.6
              ? 'balanced between conventional and creative'
              : 'creative, experimental, and surprising';

    return `Generate a MIDI pattern based on this description: "${prompt}"
- Target approximately ${String(numNotes)} notes
- Style should be ${creativityDesc}
- Output ONLY the JSON object, nothing else.`;
}

function parseMidiResponse(raw: string): GeneratedNote[] {
    try {
        const jsonMatch = raw.match(/\{[\s\S]*"notes"[\s\S]*\}/);
        if (!jsonMatch) {
            return [];
        }

        const parsed = JSON.parse(jsonMatch[0]) as LlmMidiResponse;
        if (!Array.isArray(parsed.notes)) {
            return [];
        }

        return parsed.notes
            .filter(
                (note) =>
                    typeof note.pitch === 'number' &&
                    typeof note.velocity === 'number' &&
                    typeof note.start_beat === 'number' &&
                    typeof note.duration_beats === 'number'
            )
            .map((note) => ({
                pitch: clamp(Math.round(note.pitch), 0, 127),
                velocity: clamp(Math.round(note.velocity), 1, 127),
                start_beat: Math.max(0, note.start_beat),
                duration_beats: Math.max(0.0625, note.duration_beats),
            }));
    } catch {
        return [];
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/**
 * When LLM output fails, try to find the closest matching template from the library
 * and generate notes from it with default parameters.
 */
function fallbackToPatternMatch(prompt: string): GeneratedNote[] {
    const q = prompt.toLowerCase();

    // Try tag/name match from templates
    const matched =
        filterTemplates({ query: q })[0] ??
        PATTERN_TEMPLATES.find((t) => t.tags.some((tag) => q.includes(tag)) || t.name.toLowerCase().includes(q));

    if (matched) {
        const notes = matched.generate({ key: 'C', scale: 'minor', density: 5, complexity: 5 });
        return notes.map((note) => ({
            pitch: note.pitch,
            velocity: note.velocity,
            start_beat: note.startBeat,
            duration_beats: note.durationBeats,
        }));
    }

    // Absolute fallback: simple C major arpeggio
    return [
        { pitch: 60, velocity: 80, start_beat: 0, duration_beats: 0.5 },
        { pitch: 64, velocity: 75, start_beat: 0.5, duration_beats: 0.5 },
        { pitch: 67, velocity: 70, start_beat: 1, duration_beats: 0.5 },
        { pitch: 72, velocity: 75, start_beat: 1.5, duration_beats: 0.5 },
        { pitch: 67, velocity: 70, start_beat: 2, duration_beats: 0.5 },
        { pitch: 64, velocity: 75, start_beat: 2.5, duration_beats: 0.5 },
        { pitch: 60, velocity: 80, start_beat: 3, duration_beats: 0.5 },
        { pitch: 64, velocity: 75, start_beat: 3.5, duration_beats: 0.5 },
    ];
}
