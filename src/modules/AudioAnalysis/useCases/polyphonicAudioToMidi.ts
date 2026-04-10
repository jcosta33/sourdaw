/**
 * Use case: Polyphonic audio-to-MIDI conversion using @spotify/basic-pitch.
 *
 * Unlike the simple onset-detection in audioToMidi.ts, basic-pitch uses a
 * neural network (TensorFlow.js) to detect polyphonic notes with accurate
 * pitch, velocity, duration, and pitch bends. ~10 MB model, runs entirely
 * in the browser.
 *
 * License: Apache-2.0 (safe for commercial use).
 */

import { BasicPitch, outputToNotesPoly, noteFramesToTime, addPitchBendsToNoteEvents } from '@spotify/basic-pitch';
import { type NoteEventTime } from '@spotify/basic-pitch';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { audioBufferCache } from '#/modules/AudioEngine';
import { getAllTracks } from '#/modules/Arrangement';

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

let basicPitchModel: BasicPitch | null = null;

// ── Core conversion ─────────────────────────────────────────────────────

/**
 * Convert an audio clip to MIDI notes using polyphonic pitch detection.
 * This is significantly more accurate than the simple onset-detection
 * approach in audioToMidi.ts, especially for melodic content.
 *
 * @returns The generated notes and the IDs of the created clip/track.
 */
export const polyphonicAudioToMidi = inject({ logger })(({ logger }) => {
    const getBasicPitchModel = (): BasicPitch => {
        if (!basicPitchModel) {
            const modelUrl = new URL('../../../node_modules/@spotify/basic-pitch/model/model.json', import.meta.url)
                .href;
            logger.info(`[Basic Pitch] Loading model from ${modelUrl}`);
            basicPitchModel = new BasicPitch(modelUrl);
        }
        return basicPitchModel;
    };

    return async function polyphonicAudioToMidi(
        options: PolyphonicAudioToMidiOptions
    ): Promise<PolyphonicAudioToMidiResult | null> {
        const { clipId, onsetThreshold = 0.5, frameThreshold = 0.3, minNoteLength = 11, onProgress } = options;

        // Find the source clip and its audio buffer
        const clip = getAllTracks()
            .flatMap((t) => t.clips)
            .find((c) => c.id === clipId);
        if (!clip) {
            logger.warn(`[Basic Pitch] Clip not found: ${clipId}`);
            return null;
        }

        const bufferId = clip.audioBufferId ?? clipId;
        const buffer = audioBufferCache.get(bufferId);
        if (!buffer) {
            logger.warn(`[Basic Pitch] Audio buffer not found: ${bufferId}`);
            return null;
        }

        logger.info(
            `[Basic Pitch] Starting polyphonic analysis on "${clip.name}" (${String(buffer.duration.toFixed(1))}s)`
        );

        // Run the neural network inference
        const model = getBasicPitchModel();
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
                (f, o, c) => {
                    frames = f;
                    onsets = o;
                    contours = c;
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
    };
});
