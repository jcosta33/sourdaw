import { getChromePlaybackStats } from './getChromePlaybackStats';

import type { AudioEnginePlaybackStats } from '../../models/AudioEngineState';

export function readPlaybackStats(context: AudioContext): AudioEnginePlaybackStats {
    const stats = getChromePlaybackStats(context);
    return {
        underrunDuration: stats.underrunDuration,
        underrunEvents: stats.underrunEvents,
        totalDuration: stats.totalDuration,
        averageLatency: stats.averageLatency,
        minimumLatency: stats.minimumLatency,
        maximumLatency: stats.maximumLatency,
    };
}
