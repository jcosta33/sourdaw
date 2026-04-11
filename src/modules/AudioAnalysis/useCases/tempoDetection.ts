import { audioBufferCache } from '#/modules/AudioEngine/stores';

export function detectTempo(audioBufferId: string): number | null {
    const buffer = audioBufferCache.get(audioBufferId);
    if (!buffer) {
        return null;
    }

    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    // Onset detection using energy difference
    const frameSize = Math.floor(sampleRate * 0.01); // 10ms frames
    const energies: number[] = [];
    for (let i = 0; i < channelData.length; i += frameSize) {
        let energy = 0;
        const end = Math.min(i + frameSize, channelData.length);
        for (let j = i; j < end; j++) {
            energy += channelData[j]! * channelData[j]!;
        }
        energies.push(energy);
    }

    // Find onsets (energy peaks)
    const onsets: number[] = [];
    for (let i = 1; i < energies.length; i++) {
        const diff = energies[i]! - energies[i - 1]!;
        if (diff > 0) {
            const avg = energies.slice(Math.max(0, i - 10), i).reduce((a, b) => a + b, 0) / Math.min(i, 10);
            if (energies[i]! > avg * 2) {
                onsets.push((i * frameSize) / sampleRate);
            }
        }
    }

    if (onsets.length < 4) {
        return null;
    }

    // Calculate inter-onset intervals
    const intervals: number[] = [];
    for (let i = 1; i < onsets.length; i++) {
        intervals.push(onsets[i]! - onsets[i - 1]!);
    }

    // Cluster intervals to find the most common beat period
    // Use a histogram approach with 1ms bins
    const histogram = new Map<number, number>();
    for (const interval of intervals) {
        const binMs = Math.round(interval * 1000);
        if (binMs >= 200 && binMs <= 2000) {
            // 30-300 BPM range
            histogram.set(binMs, (histogram.get(binMs) ?? 0) + 1);
            const half = Math.round(binMs / 2);
            if (half >= 200) {
                histogram.set(half, (histogram.get(half) ?? 0) + 0.5);
            }
            const dbl = binMs * 2;
            if (dbl <= 2000) {
                histogram.set(dbl, (histogram.get(dbl) ?? 0) + 0.5);
            }
        }
    }

    if (histogram.size === 0) {
        return null;
    }

    let bestBin = 0;
    let bestCount = 0;
    for (const [bin, count] of histogram) {
        if (count > bestCount) {
            bestCount = count;
            bestBin = bin;
        }
    }

    const bpm = Math.round(60000 / bestBin);
    let normalizedBpm = bpm;
    while (normalizedBpm < 60) {
        normalizedBpm *= 2;
    }
    while (normalizedBpm > 200) {
        normalizedBpm /= 2;
    }

    return Math.round(normalizedBpm);
}
