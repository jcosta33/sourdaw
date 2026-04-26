import { addMidiNote } from '#/modules/MIDI/useCases';

import { addTrack } from '../addTrack';
import { addClip } from '../clip/addClip';

import { getBufferForClip } from './helpers';

// eslint-disable-next-line @typescript-eslint/require-await -- async API contract; callers use await; synchronous implementation pending real audio-AI backend
export async function audioToMidi(clipId: string): Promise<void> {
    const result = getBufferForClip(clipId);
    if (!result) {
        return;
    }
    const { buffer } = result;

    // 1. Create a new MIDI track to dump the notes into
    const newTrack = addTrack({ name: 'Extracted MIDI', kind: 'midi' });
    if (!newTrack) {
        return;
    }

    const totalDurationSecs = buffer.length / buffer.sampleRate;
    const newClip = addClip({
        trackId: newTrack.id,
        startBeat: 0,
        endBeat: totalDurationSecs * 2,
        name: 'Extracted Notes',
        type: 'midi',
    });
    if (!newClip) {
        return;
    }

    // 2. Onset detection via amplitude threshold
    const data = buffer.getChannelData(0);
    let maxAmp = 0;
    for (let index = 0; index < data.length; index++) {
        if (Math.abs(data[index]!) > maxAmp) {
            maxAmp = Math.abs(data[index]!);
        }
    }
    const onsetThreshold = maxAmp * 0.4;

    const onsets: number[] = [];
    for (let index = 0; index < data.length; index++) {
        if (Math.abs(data[index]!) > onsetThreshold) {
            onsets.push(index);
            index += Math.floor(buffer.sampleRate * 0.125); // 8th note skip
        }
    }

    // 3. For each onset, estimate pitch via zero-crossing frequency
    for (let index = 0; index < onsets.length; index++) {
        const onset = onsets[index]!;

        // Count zero crossings in a window to estimate frequency
        const windowSamples = Math.min(2048, data.length - onset);
        let crossings = 0;
        for (let jIndex = onset + 1; jIndex < onset + windowSamples; jIndex++) {
            if ((data[jIndex]! >= 0 && data[jIndex - 1]! < 0) || (data[jIndex]! < 0 && data[jIndex - 1]! >= 0)) {
                crossings++;
            }
        }

        // Zero-crossing rate to frequency: freq ≈ (crossings / 2) * (sampleRate / windowSamples)
        const estimatedHz = (crossings / 2) * (buffer.sampleRate / windowSamples);

        // Convert Hz to MIDI pitch: MIDI = 69 + 12 * log2(freq / 440)
        // Clamp to audible/musical range (50 Hz to 4000 Hz)
        const clampedHz = Math.max(50, Math.min(4000, estimatedHz));
        const midiPitch = Math.round(69 + 12 * Math.log2(clampedHz / 440));
        const pitch = Math.max(21, Math.min(108, midiPitch)); // Piano range A0-C8

        // Calculate beat position (assuming 120 BPM = 2 beats per second)
        const timeSecs = onset / buffer.sampleRate;
        const beatPos = timeSecs * 2;

        // Estimate velocity from local amplitude
        const localAmp = Math.abs(data[onset]!);
        const velocity = Math.max(30, Math.min(127, Math.round((localAmp / maxAmp) * 127)));

        addMidiNote(newClip.id, pitch, beatPos, 0.25, velocity);
    }
}
