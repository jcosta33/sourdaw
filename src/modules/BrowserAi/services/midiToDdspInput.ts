/**
 * Service: Convert MIDI note sequence to DDSP frame-level pitch and loudness.
 *
 * DDSP synthesis-only mode:
 * - Feed pitch (Hz) and loudness (dB) directly to the decoder
 * - Frame rate: 250 Hz (frame_size=128 at 16 kHz) — typical for DDSP models
 *
 * This implements spec requirement §9.
 */

import { midiToHz, velocityToDb } from './audioResampler';

export type MidiNote = {
    /** MIDI note number 0–127 */
    pitch: number;
    /** MIDI velocity 0–127 */
    velocity: number;
    /** Start time in seconds */
    startSec: number;
    /** Duration in seconds */
    durationSec: number;
};

type MidiToDdspInputInput = {
    notes: MidiNote[];
    durationSec: number;
    frameRate?: number;
    /** Attack time in seconds for amplitude envelope */
    attackSec?: number;
    /** Release time in seconds for amplitude envelope */
    releaseSec?: number;
};

type MidiToDdspInputOutput = {
    pitchHz: Float32Array;
    loudnessDb: Float32Array;
    nFrames: number;
};

/**
 * Convert a MIDI note sequence to per-frame pitch (Hz) and loudness (dB) arrays.
 * Silence inserts pitch=0, loudness=-120 dB.
 */
export function midiToDdspInput({
    notes,
    durationSec,
    frameRate = 250,
    attackSec = 0.01,
    releaseSec = 0.05,
}: MidiToDdspInputInput): MidiToDdspInputOutput {
    const nFrames = Math.ceil(durationSec * frameRate);
    const pitchHz = new Float32Array(nFrames);
    const loudnessDb = new Float32Array(nFrames).fill(-120);

    for (const note of notes) {
        const freqHz = midiToHz(note.pitch);
        const targetDb = velocityToDb(note.velocity);
        const startFrame = Math.floor(note.startSec * frameRate);
        const endFrame = Math.min(nFrames, Math.ceil((note.startSec + note.durationSec) * frameRate));

        const attackFrames = Math.ceil(attackSec * frameRate);
        const releaseFrames = Math.ceil(releaseSec * frameRate);

        for (let frame = startFrame; frame < endFrame; frame++) {
            if (frame >= nFrames) {
                break;
            }
            pitchHz[frame] = freqHz;

            // Amplitude envelope: linear attack, linear release
            const noteFrame = frame - startFrame;
            const noteLength = endFrame - startFrame;

            let gain = 1;
            if (noteFrame < attackFrames) {
                gain = noteFrame / attackFrames;
            } else if (noteFrame > noteLength - releaseFrames) {
                gain = (noteLength - noteFrame) / releaseFrames;
            }

            // Clamp gain
            gain = Math.max(0, Math.min(1, gain));
            loudnessDb[frame] = gain > 0 ? targetDb + 20 * Math.log10(gain) : -120;
        }
    }

    return { pitchHz, loudnessDb, nFrames };
}
