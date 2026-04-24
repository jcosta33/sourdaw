import { getBufferForClip } from './helpers';

// eslint-disable-next-line @typescript-eslint/require-await -- async API contract; callers use await; synchronous implementation pending real audio-AI backend
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
    for (let index = 0; index < data.length; index++) {
        if (Math.abs(data[index]!) > threshold) {
            threshold = Math.abs(data[index]!);
        }
    }
    threshold *= 0.6; // 60% of max amplitude for onset

    const peaks: number[] = [];
    for (let index = 0; index < data.length; index++) {
        if (Math.abs(data[index]!) > threshold) {
            peaks.push(index);
            index += Math.floor(buffer.sampleRate * 0.2); // Skip 200ms to avoid double triggers
        }
    }

    if (peaks.length < 2) {
        return 120;
    } // Default fallback

    const intervals = [];
    for (let index = 1; index < peaks.length; index++) {
        intervals.push((peaks[index]! - peaks[index - 1]!) / buffer.sampleRate);
    }

    // Sort intervals and take the median to avoid outlier clicks
    intervals.sort((alpha, buffer1) => alpha - buffer1);
    const medianInterval = intervals[Math.floor(intervals.length / 2)]!;

    return Math.max(40, Math.min(300, Math.round(60 / medianInterval)));
}
