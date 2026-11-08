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

import { outputToNotesPoly, noteFramesToTime, addPitchBendsToNoteEvents } from '@spotify/basic-pitch';
import { type BasicPitch, type NoteEventTime } from '@spotify/basic-pitch';

import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';
import { getAllTracks } from '#/modules/Arrangement/useCases';
import { getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
import {
    projectRevisionMatchesLiveIgnoringSaveWrites,
    settlePendingProjectWritesAndCaptureRevision,
} from '#/modules/CrdtDocument/useCases';

import { loadBasicPitchModel } from '../repositories/loadBasicPitchModel';

/**
 * The Basic Pitch neural network was trained on exactly 22 050 Hz input; any
 * other rate must be resampled to this before inference or the model's frame
 * grid (and therefore every detected note's timing) is wrong.
 */
const BASIC_PITCH_SAMPLE_RATE = 22_050;

// ── Types ───────────────────────────────────────────────────────────────

export type PolyphonicAudioToMidiOptions = {
    clipId: string;
    onsetThreshold?: number;
    frameThreshold?: number;
    minNoteLength?: number;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
};

export type PolyphonicAudioToMidiResult = {
    notes: NoteEventTime[];
    /** Source clip boundaries, for callers that need to place notes in the timeline. */
    sourceClip: { startBeat: number; endBeat: number; name: string; projectRevision: string; signal?: AbortSignal };
};

// ── Model singleton ─────────────────────────────────────────────────────
//
// §64.2 — Wrap the lazy-loaded Basic Pitch model in a holder object so it
// lives behind a single mutation surface and cannot be reassigned from
// outside this file. The previous `let basicPitchModel` was an exported
// mutable binding pattern we've been systematically retiring.
//
// Concurrent callers share the actual topology-and-weights load. Failed loads
// clear pending so a later conversion can load a fresh model.
const modelHolder: { instance: BasicPitch | null; pending: Promise<BasicPitch> | null } = {
    instance: null,
    pending: null,
};

async function getBasicPitchModel(): Promise<BasicPitch> {
    if (modelHolder.instance) {
        return modelHolder.instance;
    }

    modelHolder.pending ??= (async (): Promise<BasicPitch> => {
        logger.info('[Basic Pitch] Loading bundled model and weights');
        return loadBasicPitchModel();
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

type PitchModelOutput = { frames: number[][]; onsets: number[][]; contours: number[][] };

async function evaluatePitchModel(
    model: BasicPitch,
    buffer: AudioBuffer,
    onProgress: PolyphonicAudioToMidiOptions['onProgress']
): Promise<PitchModelOutput> {
    const output: PitchModelOutput = { frames: [], onsets: [], contours: [] };
    await model.evaluateModel(
        buffer,
        (frames, onsets, contours) => {
            // Each callback contains the next unwrapped model window.
            // Keep one ordered frame timeline for notes and pitch bends.
            for (const frame of frames) {
                output.frames.push(frame);
            }
            for (const onset of onsets) {
                output.onsets.push(onset);
            }
            for (const contour of contours) {
                output.contours.push(contour);
            }
        },
        (percent) => {
            onProgress?.(percent);
        }
    );
    return output;
}

/**
 * Convert an audio clip to MIDI notes using polyphonic pitch detection.
 * This is significantly more accurate than the simple onset-detection
 * approach in audioToMidi.ts, especially for melodic content.
 *
 * @returns Detected notes and transient source authority for the later insertion.
 */
export async function polyphonicAudioToMidi(
    options: PolyphonicAudioToMidiOptions
): Promise<PolyphonicAudioToMidiResult | null> {
    if (!MODEL_RELEASE_ADMISSION.basicPitch) {
        throw new Error('Basic Pitch model artifacts are not admitted in this release');
    }
    const { clipId, onsetThreshold = 0.5, frameThreshold = 0.3, minNoteLength = 11, onProgress } = options;
    if (options.signal?.aborted) {
        return null;
    }
    const projectRevision = settlePendingProjectWritesAndCaptureRevision();
    const sourceIsCurrent = () =>
        options.signal?.aborted !== true && projectRevisionMatchesLiveIgnoringSaveWrites(projectRevision);

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
    let model: BasicPitch;
    try {
        model = await getBasicPitchModel();
    } catch (error) {
        logger.error(new Error(`[Basic Pitch] Model loading failed: ${String(error)}`));
        return null;
    }
    if (!sourceIsCurrent()) {
        return null;
    }
    let evaluationBuffer = buffer;

    // If our DAW engine is running at 44.1kHz or 48kHz, we must downsample first.
    if (buffer.sampleRate !== BASIC_PITCH_SAMPLE_RATE) {
        logger.info(`[Basic Pitch] Resampling input from ${buffer.sampleRate}Hz to ${BASIC_PITCH_SAMPLE_RATE}Hz`);

        // Calculate the exact number of frames needed at 22050Hz
        const targetLength = Math.ceil((buffer.length * BASIC_PITCH_SAMPLE_RATE) / buffer.sampleRate);
        const offlineCtx = new OfflineAudioContext(1, targetLength, BASIC_PITCH_SAMPLE_RATE);

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start();

        evaluationBuffer = await offlineCtx.startRendering();
        if (!sourceIsCurrent()) {
            return null;
        }
    }

    let modelOutput: PitchModelOutput;
    try {
        modelOutput = await evaluatePitchModel(model, evaluationBuffer, onProgress);
    } catch (error) {
        logger.error(new Error(`[Basic Pitch] Model evaluation failed: ${String(error)}`));
        return null;
    }

    // Convert model output to note events
    if (!sourceIsCurrent()) {
        return null;
    }
    let noteEvents = outputToNotesPoly(
        modelOutput.frames,
        modelOutput.onsets,
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
    noteEvents = addPitchBendsToNoteEvents(modelOutput.contours, noteEvents);

    // Convert frame-based timing to real time
    const notesWithTime = noteFramesToTime(noteEvents);

    if (notesWithTime.length === 0) {
        logger.warn('[Basic Pitch] No notes detected');
        return null;
    }

    logger.info(`[Basic Pitch] Detected ${String(notesWithTime.length)} polyphonic notes`);

    return {
        notes: notesWithTime,
        sourceClip: {
            startBeat: clip.startBeat,
            endBeat: clip.endBeat,
            name: clip.name,
            projectRevision,
            signal: options.signal,
        },
    };
}
