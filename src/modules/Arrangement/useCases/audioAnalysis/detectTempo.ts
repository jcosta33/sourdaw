import { getBufferForClip } from './helpers';

export async function detectTempo(clipId: string): Promise<number | null> {
    const result = getBufferForClip(clipId);
    if (!result) {
        return null;
    }
    const { buffer } = result;

    // Naive offline amplitude onset detection
    const data = buffer.getChannelData(0);
    let threshold = 0.0;

    // Find absolute max to normalize threshold
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]!) > threshold) {
            threshold = Math.abs(data[i]!);
        }
    }
    threshold *= 0.6; // 60% of max amplitude for onset

    const peaks: number[] = [];
    for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]!) > threshold) {
            peaks.push(i);
            i += Math.floor(buffer.sampleRate * 0.2); // Skip 200ms to avoid double triggers
        }
    }

    if (peaks.length < 2) {
        return 120;
    } // Default fallback

    const intervals = [];
    for (let i = 1; i < peaks.length; i++) {
        intervals.push((peaks[i]! - peaks[i - 1]!) / buffer.sampleRate);
    }

    // Sort intervals and take the median to avoid outlier clicks
    intervals.sort((a, b) => a - b);
    const medianInterval = intervals[Math.floor(intervals.length / 2)]!;

    return Math.max(40, Math.min(300, Math.round(60 / medianInterval)));
}