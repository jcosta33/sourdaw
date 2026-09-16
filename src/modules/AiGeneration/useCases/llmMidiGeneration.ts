import { generateWebLlmCompletion, resolveBackend, streamCloudChatCompletion } from '#/modules/AiRuntime/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { createAiGenerationError } from '../errors/AiGenerationError';
import { type KeyName, type ScaleType } from '../models/MidiPatternType';
import { readBalancedObject } from '../services/readBalancedObject';

import { filterTemplates } from './patternQueries/filterTemplates';
import { PATTERN_TEMPLATES } from './patternQueries/PATTERN_TEMPLATES';

type MidiGenerationNote = {
    pitch: number;
    velocity: number;
    start_beat: number;
    duration_beats: number;
};

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

const MIN_GENERATION_NOTES = 4;
const MAX_GENERATION_NOTES = 128;
const MAX_GENERATED_NOTE_END_BEATS = 1024;

// ── Built-in fallback key/scale admission ──

const FALLBACK_KEY: KeyName = 'C';
const FALLBACK_SCALE: ScaleType = 'minor';

/**
 * Scale phrases a prompt may name, longest first so "pentatonic minor" wins
 * over plain "minor". Bare "pentatonic" is deliberately absent: the registry
 * has both pentatonic variants and a bare mention does not say which.
 */
const SCALE_PHRASES: readonly (readonly [phrase: string, scale: ScaleType])[] = [
    ['harmonic minor', 'harmonic-minor'],
    ['minor pentatonic', 'pentatonic-minor'],
    ['pentatonic minor', 'pentatonic-minor'],
    ['major pentatonic', 'pentatonic-major'],
    ['pentatonic major', 'pentatonic-major'],
    ['dorian', 'dorian'],
    ['blues', 'blues'],
    ['major', 'major'],
    ['minor', 'minor'],
];

const SCALE_PHRASE_ALTERNATION = SCALE_PHRASES.map(([phrase]) => phrase.replaceAll(' ', '\\s+')).join('|');

// A note letter as a standalone word with an optional accidental ("f#",
// "b flat", "e♭"). A letter only counts as a key when it is paired with a
// scale name or a "key of" phrase, so ordinary prose never reads as one.
const NOTE_PATTERN = String.raw`([a-g])(?:\s*(?:#|♯|sharp|b|♭|flat))?`;

const KEY_BEFORE_SCALE_PATTERN = new RegExp(String.raw`\b${NOTE_PATTERN}\s+(?:${SCALE_PHRASE_ALTERNATION})\b`);
const KEY_AFTER_SCALE_PATTERN = new RegExp(String.raw`\b(?:${SCALE_PHRASE_ALTERNATION})\s+in\s+${NOTE_PATTERN}\b`);
const KEY_OF_PATTERN = new RegExp(String.raw`\bkey\s+of\s+${NOTE_PATTERN}\b`);

/** Enharmonic note spellings resolved to registry key names. */
const KEY_BY_NOTE: Record<string, KeyName> = {
    c: 'C',
    'c#': 'C#',
    db: 'C#',
    cb: 'B',
    d: 'D',
    'd#': 'D#',
    eb: 'D#',
    e: 'E',
    f: 'F',
    'f#': 'F#',
    gb: 'F#',
    fb: 'E',
    g: 'G',
    'g#': 'G#',
    ab: 'G#',
    a: 'A',
    'a#': 'A#',
    bb: 'A#',
    b: 'B',
};

type RequestedKeyScale = { key: KeyName; scale: ScaleType };

/**
 * Read the key and scale a prompt names into the template registry's bounded
 * enums. Anything the prompt does not name — or names outside those enums —
 * keeps the built-in defaults, so fallback output never depends on freeform
 * prompt text.
 */
function parseRequestedKeyAndScale(promptText: string): RequestedKeyScale {
    const text = promptText.toLowerCase().replaceAll(/[-_]/g, ' ');
    return {
        key: parseRequestedKey(text) ?? FALLBACK_KEY,
        scale: parseRequestedScale(text) ?? FALLBACK_SCALE,
    };
}

function parseRequestedScale(text: string): ScaleType | null {
    for (const [phrase, scale] of SCALE_PHRASES) {
        if (new RegExp(String.raw`\b${phrase.replaceAll(' ', '\\s+')}\b`).test(text)) {
            return scale;
        }
    }
    return null;
}

function parseRequestedKey(text: string): KeyName | null {
    const match =
        KEY_BEFORE_SCALE_PATTERN.exec(text) ?? KEY_AFTER_SCALE_PATTERN.exec(text) ?? KEY_OF_PATTERN.exec(text);
    return match ? noteToKey(match[1]!, match[2]) : null;
}

function noteToKey(note: string, accidental: string | undefined): KeyName | null {
    const suffix = (accidental ?? '')
        .replaceAll(/\s+/g, '')
        .replace('sharp', '#')
        .replace('flat', 'b')
        .replace('♯', '#')
        .replace('♭', 'b');
    return KEY_BY_NOTE[`${note}${suffix}`] ?? null;
}

// ── Types ──

export async function generateMidiViaLlm(
    prompt: string,
    numNotes: number = 32,
    creativity: number = 0.65
): Promise<MidiGenerationNote[]> {
    const requestedNoteLimit = normalizeRequestedNoteLimit(numNotes);
    const userMessage = buildUserMessage(prompt, requestedNoteLimit, creativity);

    const backend = resolveBackend();
    let rawResponse: string;

    if (backend === 'none') {
        notifyUser(
            'No AI backend is configured — using a built-in pattern instead. Configure a hosted provider in the desktop app or use Chrome with WebGPU.',
            'warning'
        );
        return fallbackToPatternMatch(prompt).slice(0, requestedNoteLimit);
    }

    if (backend === 'cloud') {
        let accumulated = '';
        const outcome = await streamCloudChatCompletion(
            [
                { role: 'system', content: MIDI_SYSTEM_PROMPT },
                { role: 'user', content: userMessage },
            ],
            (token: string) => {
                accumulated += token;
            },
            { maxTokens: 2000 }
        );
        if (outcome.status === 'incomplete') {
            throw createAiGenerationError(`Hosted AI MIDI response was incomplete (${outcome.reason}).`);
        }
        rawResponse = accumulated;
    } else if (backend === 'webllm') {
        rawResponse = await generateWebLlmCompletion(MIDI_SYSTEM_PROMPT, userMessage);
    } else {
        throw createAiGenerationError('AI backend initialization was cancelled before MIDI generation.');
    }

    const notes = parseMidiResponse(rawResponse, requestedNoteLimit);

    if (notes.length === 0) {
        notifyUser(
            'AI returned an unreadable response — falling back to a built-in pattern. Try rephrasing your prompt.',
            'warning'
        );
        return fallbackToPatternMatch(prompt).slice(0, requestedNoteLimit);
    }

    return notes;
}

function fallbackToPatternMatch(promptText: string): MidiGenerationNote[] {
    const query = promptText.toLowerCase();

    const matched =
        filterTemplates({ query })[0] ??
        PATTERN_TEMPLATES.find(
            (time) => time.tags.some((tag) => query.includes(tag)) || time.name.toLowerCase().includes(query)
        );

    if (matched) {
        // Density and complexity keep the built-in defaults: the panel supplies
        // neither for this path, and nothing else in the prompt bounds them.
        const { key, scale } = parseRequestedKeyAndScale(query);
        const notes = matched.generate({ key, scale, density: 5, complexity: 5 });
        return notes.map((note) => ({
            pitch: note.pitch,
            velocity: note.velocity,
            start_beat: note.startBeat,
            duration_beats: note.durationBeats,
        }));
    }

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

// ── Helpers ──

function buildUserMessage(prompt: string, numNotes: number, creativity: number): string {
    const creativityDesc = (() => {
        if (creativity < 0.3) {
            return 'very predictable and conventional';
        }
        if (creativity < 0.6) {
            return 'balanced between conventional and creative';
        }
        return 'creative, experimental, and surprising';
    })();

    return `Generate a MIDI pattern based on this description: "${prompt}"
- Target approximately ${String(numNotes)} notes
- Style should be ${creativityDesc}
- Output ONLY the JSON object, nothing else.`;
}

function normalizeRequestedNoteLimit(numNotes: number): number {
    if (!Number.isFinite(numNotes)) {
        return 32;
    }
    return Math.min(MAX_GENERATION_NOTES, Math.max(MIN_GENERATION_NOTES, Math.floor(numNotes)));
}

function parseMidiResponse(raw: string, maxNotes: number): MidiGenerationNote[] {
    try {
        const jsonText = extractNotesJsonObject(raw);
        if (jsonText === null) {
            return [];
        }

        const parsed: unknown = JSON.parse(jsonText);
        if (!isExactRecord(parsed, ['notes'])) {
            return [];
        }
        const notes = parsed.notes;
        if (
            !Array.isArray(notes) ||
            notes.length === 0 ||
            notes.length > maxNotes ||
            !notes.every(isMidiGenerationNote)
        ) {
            return [];
        }
        return notes;
    } catch {
        return [];
    }
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}

function isMidiGenerationNote(value: unknown): value is MidiGenerationNote {
    if (!isExactRecord(value, ['pitch', 'velocity', 'start_beat', 'duration_beats'])) {
        return false;
    }
    let noteEnd = Number.NaN;
    if (typeof value.start_beat === 'number' && typeof value.duration_beats === 'number') {
        noteEnd = value.start_beat + value.duration_beats;
    }
    return (
        typeof value.pitch === 'number' &&
        Number.isInteger(value.pitch) &&
        value.pitch >= 0 &&
        value.pitch <= 127 &&
        typeof value.velocity === 'number' &&
        Number.isInteger(value.velocity) &&
        value.velocity >= 1 &&
        value.velocity <= 127 &&
        typeof value.start_beat === 'number' &&
        Number.isFinite(value.start_beat) &&
        value.start_beat >= 0 &&
        typeof value.duration_beats === 'number' &&
        Number.isFinite(value.duration_beats) &&
        value.duration_beats >= 0.0625 &&
        Number.isFinite(noteEnd) &&
        noteEnd <= MAX_GENERATED_NOTE_END_BEATS
    );
}

/**
 * Find the first balanced-brace JSON object in `raw` that contains a "notes"
 * key, or null if none. String literals (with escapes) are tracked so braces
 * inside strings don't skew the depth count.
 *
 * Preferred over a greedy /\{[\s\S]*"notes"[\s\S]*\}/: when the model emits
 * several objects the greedy form spans from the first `{` to the last `}`,
 * merging them into one un-parseable blob.
 */
function extractNotesJsonObject(raw: string): string | null {
    for (let start = raw.indexOf('{'); start !== -1; start = raw.indexOf('{', start + 1)) {
        const candidate = readBalancedObject(raw, start);
        if (candidate !== null && candidate.includes('"notes"')) {
            return candidate;
        }
    }
    return null;
}
