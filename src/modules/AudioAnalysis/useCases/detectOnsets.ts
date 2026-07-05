export type DetectedOnset = {
    timeSec: number;
    amplitude: number;
    pitch?: number;
};

const FRAME_SIZE = 1024;
const HOP_SIZE = 512;

function computeRmsEnergy(data: Float32Array, start: number, length: number): number {
    let sum = 0;
    const end = Math.min(start + length, data.length);
    for (let index = start; index < end; index++) {
        sum += data[index]! * data[index]!;
    }
    return Math.sqrt(sum / (end - start));
}

export function detectOnsets(buffer: AudioBuffer, sensitivity: number, minIntervalSec: number): DetectedOnset[] {
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;

    const numFrames = Math.floor((channelData.length - FRAME_SIZE) / HOP_SIZE) + 1;
    if (numFrames < 2) {
        return [];
    }

    const energies = new Float32Array(numFrames);
    for (let index = 0; index < numFrames; index++) {
        energies[index] = computeRmsEnergy(channelData, index * HOP_SIZE, FRAME_SIZE);
    }

    const flux = new Float32Array(numFrames - 1);
    let maxFlux = 0;
    for (let index = 0; index < flux.length; index++) {
        const diff = energies[index + 1]! - energies[index]!;
        flux[index] = Math.max(0, diff);
        if (flux[index]! > maxFlux) {
            maxFlux = flux[index]!;
        }
    }

    if (maxFlux < 1e-8) {
        return [];
    }

    const threshold = sensitivity * maxFlux;
    const onsets: DetectedOnset[] = [];
    const minIntervalFrames = Math.floor((minIntervalSec * sampleRate) / HOP_SIZE);

    let lastOnsetFrame = -minIntervalFrames;

    for (let index = 1; index < flux.length - 1; index++) {
        if (
            flux[index]! > threshold &&
            flux[index]! > flux[index - 1]! &&
            flux[index]! >= flux[index + 1]! &&
            index - lastOnsetFrame >= minIntervalFrames
        ) {
            const timeSec = (index * HOP_SIZE) / sampleRate;
            onsets.push({
                timeSec,
                amplitude: energies[index]!,
            });
            lastOnsetFrame = index;
        }
    }

    return onsets;
}
