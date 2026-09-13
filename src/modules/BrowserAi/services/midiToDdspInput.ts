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
 * Overlap shorter than this is float noise in upstream beat→second conversion,
 * not a chord. Real overlaps are orders of magnitude larger.
 */
const OVERLAP_EPSILON_SEC = 1e-6;

function noteName(pitch: number): string {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
    const name = names[((pitch % 12) + 12) % 12]!;
    const octave = Math.floor(pitch / 12) - 1;
    return `${name}${octave}`;
}

/**
 * DDSP is monophonic: one pitch per frame. Two overlapping notes would each
 * write the same frames in input order, so the surviving voice would be
 * whichever note came last — an arbitrary, order-dependent reduction. Refuse
 * the input instead, naming the pair so a musician can fix the clip.
 */
function rejectOverlappingNotes(notes: readonly MidiNote[]): void {
    const withPositions = notes.map((note, index) => ({ note, index }));
    const sounding = withPositions.filter(({ note }) => note.durationSec > 0);
    const ordered = sounding.sort(
        (left, right) =>
            left.note.startSec - right.note.startSec || left.note.pitch - right.note.pitch || left.index - right.index
    );
    for (let i = 1; i < ordered.length; i++) {
        const previous = ordered[i - 1]!;
        const current = ordered[i]!;
        if (current.note.startSec + OVERLAP_EPSILON_SEC < previous.note.startSec + previous.note.durationSec) {
            throw new Error(
                `DDSP render refused: the clip is polyphonic — ${noteName(previous.note.pitch)} and ` +
                    `${noteName(current.note.pitch)} overlap around ${current.note.startSec.toFixed(3)}s, and a ` +
                    'monophonic instrument can voice only one. Remove or shorten one note, or bounce the voices to separate clips.'
            );
        }
    }
}

/**
 * Refuse polyphonic input at launch time, before any model work. Renderers call
 * this directly so a chord fails fast with an actionable explanation instead of
 * rendering an arbitrary voice.
 */
export function assertMonophonicNotes(notes: readonly MidiNote[]): void {
    rejectOverlappingNotes(notes);
}

/**
 * Convert a MIDI note sequence to per-frame pitch (Hz) and loudness (dB) arrays.
 * The note sequence must be monophonic (no overlapping notes); silence inserts
 * pitch=0, loudness=-120 dB.
 */
export function midiToDdspInput({
    notes,
    durationSec,
    frameRate = 250,
    attackSec = 0.01,
    releaseSec = 0.05,
}: MidiToDdspInputInput): MidiToDdspInputOutput {
    assertMonophonicNotes(notes);

    const nFrames = Math.ceil(durationSec * frameRate);
    const pitchHz = new Float32Array(nFrames);
    const loudnessDb = new Float32Array(nFrames).fill(-120);

    for (const note of notes) {
        const freqHz = midiToHz(note.pitch);
        const targetDb = velocityToDb(note.velocity);
        const startFrame = Math.floor(note.startSec * frameRate);
        const endFrame = Math.min(nFrames, Math.ceil((note.startSec + note.durationSec) * frameRate));

        const noteLength = endFrame - startFrame;

        // Clamp attack and release so a short note keeps a real attack ramp:
        // their combined span can never exceed the note, and each gets at most
        // half. Without this, attack+release > noteLength makes the release
        // branch win for the whole note (all-release / no-attack).
        const maxRampFrames = noteLength / 2;
        const effectiveAttack = Math.min(Math.ceil(attackSec * frameRate), maxRampFrames);
        const effectiveRelease = Math.min(Math.ceil(releaseSec * frameRate), maxRampFrames);

        for (let frame = startFrame; frame < endFrame; frame++) {
            if (frame >= nFrames) {
                break;
            }
            pitchHz[frame] = freqHz;

            // Amplitude envelope: linear attack, then sustain, then linear release.
            // Attack is tested before release so the opening frames always ramp up.
            const noteFrame = frame - startFrame;

            let gain = 1;
            if (effectiveAttack > 0 && noteFrame < effectiveAttack) {
                gain = noteFrame / effectiveAttack;
            } else if (effectiveRelease > 0 && noteFrame > noteLength - effectiveRelease) {
                gain = (noteLength - noteFrame) / effectiveRelease;
            }

            // Clamp gain
            gain = Math.max(0, Math.min(1, gain));
            loudnessDb[frame] = gain > 0 ? targetDb + 20 * Math.log10(gain) : -120;
        }
    }

    return { pitchHz, loudnessDb, nFrames };
}
