export type AudioLatencyProfile = 'low-latency' | 'high-capacity';

export const AUDIO_LATENCY_PROFILE_DEFINITIONS: Record<
    AudioLatencyProfile,
    { latencyHint: AudioContextLatencyCategory }
> = {
    'low-latency': { latencyHint: 'interactive' },
    'high-capacity': { latencyHint: 'playback' },
};

export const DEFAULT_AUDIO_LATENCY_PROFILE: AudioLatencyProfile = 'low-latency';
