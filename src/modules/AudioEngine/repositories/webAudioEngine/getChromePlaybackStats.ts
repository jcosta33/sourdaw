import type { AudioEnginePlaybackStats } from '../../models/AudioEngineState';

type ChromeAudioPlaybackStats = AudioEnginePlaybackStats & {
    resetLatency(): void;
    toJSON(): object;
};

function isChromeAudioPlaybackStats(value: unknown): value is ChromeAudioPlaybackStats {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    return (
        'underrunDuration' in value &&
        typeof value.underrunDuration === 'number' &&
        'underrunEvents' in value &&
        typeof value.underrunEvents === 'number' &&
        'totalDuration' in value &&
        typeof value.totalDuration === 'number' &&
        'averageLatency' in value &&
        typeof value.averageLatency === 'number' &&
        'minimumLatency' in value &&
        typeof value.minimumLatency === 'number' &&
        'maximumLatency' in value &&
        typeof value.maximumLatency === 'number' &&
        'resetLatency' in value &&
        typeof value.resetLatency === 'function' &&
        'toJSON' in value &&
        typeof value.toJSON === 'function'
    );
}

export function getChromePlaybackStats(context: AudioContext): ChromeAudioPlaybackStats {
    const stats = 'playbackStats' in context ? context.playbackStats : undefined;
    if (!isChromeAudioPlaybackStats(stats)) {
        throw new Error('Audio diagnostics require AudioContext.playbackStats from current stable Chrome.');
    }
    return stats;
}
