/**
 * Use case: Polyphonic audio-to-MIDI conversion using @spotify/basic-pitch.
 *
 * Unlike the simple onset-detection in audioToMidi.ts, basic-pitch uses a
 * neural network (TensorFlow.js) to detect polyphonic notes with accurate
 * pitch, velocity, duration, and pitch bends. ~10 MB model, runs entirely
 * in the browser.
 *
 * Package metadata declares Apache-2.0.
 */

import { BasicPitch, outputToNotesPoly, noteFramesToTime, addPitchBendsToNoteEvents } from '@spotify/basic-pitch';
import { type NoteEventTime } from '@spotify/basic-pitch';
// Vite `?url` import emits the asset into the production bundle and returns
// its resolved URL. Using a raw `new URL(..., import.meta.url)` pointed at
// `node_modules/` works in dev but leaves the file unbundled in production.
import basicPitchModelUrl from '@spotify/basic-pitch/model/model.json?url';

import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';
import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';

// ── Types ───────────────────────────────────────────────────────────────

export type PolyphonicAudioToMidiOptions = {
    clipId: string;
    onsetThreshold?: number;
    frameThreshold?: number;
    minNoteLength?: number;
    onProgress?: (percent: number) => void;
};

export type PolyphonicAudioToMidiResult = {
    notes: NoteEventTime[];
    /** Source clip boundaries, for callers that need to place notes in the timeline. */
    sourceClip: { startBeat: number; endBeat: number; name: string };
};

// ── Model singleton ─────────────────────────────────────────────────────
//
// §64.2 — Wrap the lazy-loaded Basic Pitch model in a holder object so it
// lives behind a single mutation surface and cannot be reassigned from
// outside this file. The previous `let basicPitchModel` was an exported
// mutable binding pattern we've been systematically retiring.
//
// `pending` memoizes the in-flight *load* promise, not just the resolved
// instance. `BasicPitch`'s constructor is synchronous today, so callers
// cannot interleave between the null-check and the assignment; but the
// model weights it kicks off internally (and any future async resolution
// of the model URL) make a single coalesced load the safe shape — every
// concurrent caller awaits one `BasicPitch`, never building a second.
const modelHolder: { instance: BasicPitch | null; pending: Promise<BasicPitch> | null } = {
    instance: null,
    pending: null,
};

async function getBasicPitchModel(): Promise<BasicPitch> {
    if (modelHolder.instance) {
        return modelHolder.instance;
    }

    modelHolder.pending ??= (async (): Promise<BasicPitch> => {
        logger.info(`[Basic Pitch] Loading model from ${basicPitchModelUrl}`);
        return new BasicPitch(basicPitchModelUrl);
    })().catch((error: unknown) => {
        modelHolder.pending = null;
        throw error;
    });

    const instance = await modelHolder.pending;
    modelHolder.instance = instance;
    modelHolder.pending = null;
    return instance;
}

// ── Core conversion ─────────────────────────────────────────────────────

/**
 * Convert an audio clip to MIDI notes using polyphonic pitch detection.
 * This is significantly more accurate than the simple onset-detection
 * approach in audioToMidi.ts, especially for melodic content.
 *
 * @returns The generated notes and the IDs of the created clip/track.
 */
export async function polyphonicAudioToMidi(
    options: PolyphonicAudioToMidiOptions
): Promise<PolyphonicAudioToMidiResult | null> {
    if (!MODEL_RELEASE_ADMISSION.basicPitch) {
        throw new Error('Basic Pitch model artifacts are not admitted in this release');
    }
    const { clipId, onsetThreshold = 0.5, frameThreshold = 0.3, minNoteLength = 11, onProgress } = options;

    // Find the source clip and its audio buffer
    const clip = getAllTracks()
        .flatMap((time) => time.clips)
        .find((context) => context.id === clipId);
    if (!clip) {
        logger.warn(`[Basic Pitch] Clip not found: ${clipId}`);
        return null;
    }

    const bufferId = clip.audioBufferId ?? clipId;
    const buffer = getCachedAudioBuffer({ bufferId });
    if (!buffer) {
        logger.warn(`[Basic Pitch] Audio buffer not found: ${bufferId}`);
        return null;
    }

    logger.info(
        `[Basic Pitch] Starting polyphonic analysis on "${clip.name}" (${String(buffer.duration.toFixed(1))}s)`
    );

    // Run the neural network inference
    const model = await getBasicPitchModel();
    let frames: number[][] = [];
    let onsets: number[][] = [];
    let contours: number[][] = [];

    let evaluationBuffer = buffer;

    // Basic Pitch requires exactly 22050Hz sample rate.
    // If our DAW engine is running at 44.1kHz or 48kHz, we must downsample first.
    if (buffer.sampleRate !== 22050) {
        logger.info(`[Basic Pitch] Resampling input from ${buffer.sampleRate}Hz to 22050Hz`);

        // Calculate the exact number of frames needed at 22050Hz
        const targetLength = Math.ceil((buffer.length * 22050) / buffer.sampleRate);
        const offlineCtx = new OfflineAudioContext(1, targetLength, 22050);

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start();

        evaluationBuffer = await offlineCtx.startRendering();
    }

    try {
        await model.evaluateModel(
            evaluationBuffer,
            (freq, output, context) => {
                frames = freq;
                onsets = output;
                contours = context;
            },
            (percent) => {
                onProgress?.(percent);
            }
        );
    } catch (error) {
        logger.error(new Error(`[Basic Pitch] Model evaluation failed: ${String(error)}`));
        return null;
    }

    // Convert model output to note events
    let noteEvents = outputToNotesPoly(
        frames,
        onsets,
        onsetThreshold,
        frameThreshold,
        minNoteLength,
        true, // inferOnsets
        null, // maxFreq
        null, // minFreq
        true, // melodiaTrick
        5 // energyTolerance
    );

    // Add pitch bends for expressive playing
    noteEvents = addPitchBendsToNoteEvents(contours, noteEvents);

    // Convert frame-based timing to real time
    const notesWithTime = noteFramesToTime(noteEvents);

    if (notesWithTime.length === 0) {
        logger.warn('[Basic Pitch] No notes detected');
        return null;
    }

    logger.info(`[Basic Pitch] Detected ${String(notesWithTime.length)} polyphonic notes`);

    return {
        notes: notesWithTime,
        sourceClip: { startBeat: clip.startBeat, endBeat: clip.endBeat, name: clip.name },
    };
}
