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

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { getTransportState } from '#/modules/Transport/useCases/transportQueries';
import { getAllTracks } from '#/modules/Track/useCases/trackQueries';
import { addClip } from '#/modules/Track/useCases/clipUseCases';
import { addMidiNote } from '#/modules/Track/useCases/midiUseCases';
import { addTrack } from '#/modules/Track/useCases/addTrack';

const logger = Container.getInstance().get(Logger);

// ── Types ───────────────────────────────────────────────────────────────

export type PolyphonicAudioToMidiOptions = {
    clipId: string;
    trackId: string;
    onsetThreshold?: number;
    frameThreshold?: number;
    minNoteLength?: number;
    onProgress?: (percent: number) => void;
};

export type PolyphonicAudioToMidiResult = {
    notes: NoteEventTime[];
    clipId: string;
    trackId: string;
};

// ── Model singleton ─────────────────────────────────────────────────────

let basicPitchModel: BasicPitch | null = null;

function getBasicPitchModel(): BasicPitch {
    if (!basicPitchModel) {
        // Uses the bundled TF.js model from the package
        basicPitchModel = new BasicPitch(
            'https://tfhub.dev/google/tfjs-model/spice/2/default/1',
        );
    }
    return basicPitchModel;
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
    options: PolyphonicAudioToMidiOptions,
): Promise<PolyphonicAudioToMidiResult | null> {
    const {
        clipId,
        trackId,
        onsetThreshold = 0.5,
        frameThreshold = 0.3,
        minNoteLength = 11,
        onProgress,
    } = options;

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

    logger.info(`[Basic Pitch] Starting polyphonic analysis on "${clip.name}" (${String(buffer.duration.toFixed(1))}s)`);

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
            },
        );
    } catch (err) {
        logger.error(new Error('[Basic Pitch] Model evaluation failed: ' + String(err)));
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
        5, // energyTolerance
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

    // Create a MIDI track and clip with the detected notes
    const result = insertNotesIntoTimeline(notesWithTime, clip, trackId);
    return result
        ? { notes: notesWithTime, clipId: result.clipId, trackId: result.trackId }
        : null;
}

// ── Timeline insertion ──────────────────────────────────────────────────

type SourceClip = {
    startBeat: number;
    endBeat: number;
    name: string;
};

function insertNotesIntoTimeline(
    notes: NoteEventTime[],
    sourceClip: SourceClip,
    trackId: string,
): { clipId: string; trackId: string } | null {
    const tempo = getTransportState()?.tempo ?? 120;
    const beatsPerSecond = tempo / 60;

    // Create or find MIDI track
    let midiTrackId = trackId;
    const existingTrack = getAllTracks().find((t) => t.id === trackId);
    if (!existingTrack || existingTrack.kind !== 'midi') {
        const newTrack = addTrack({ name: `${sourceClip.name} (MIDI)`, kind: 'midi' });
        if (!newTrack) {
            return null;
        }
        midiTrackId = newTrack.id;
    }

    // Calculate clip boundaries
    const clipStartBeat = sourceClip.startBeat;
    const endBeat = sourceClip.endBeat;

    const midiClip = addClip({
        trackId: midiTrackId,
        startBeat: clipStartBeat,
        endBeat: Math.ceil(endBeat),
        name: `${sourceClip.name} → MIDI (poly)`,
        type: 'midi',
    });

    if (!midiClip) {
        return null;
    }

    // Insert each detected note
    for (const note of notes) {
        const startBeat = note.startTimeSeconds * beatsPerSecond;
        const durationBeats = Math.max(0.0625, note.durationSeconds * beatsPerSecond);
        const velocity = Math.max(1, Math.min(127, Math.round(note.amplitude * 127)));

        addMidiNote(midiClip.id, note.pitchMidi, startBeat, durationBeats, velocity);
    }

    return { clipId: midiClip.id, trackId: midiTrackId };
}
