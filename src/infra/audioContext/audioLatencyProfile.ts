import { createLocalStorage } from '../store/storage/createLocalStorage';

export const AUDIO_LATENCY_PROFILES = ['lowLatency', 'highCapacity'] as const;

export type AudioLatencyProfile = (typeof AUDIO_LATENCY_PROFILES)[number];

export const DEFAULT_AUDIO_LATENCY_PROFILE: AudioLatencyProfile = 'lowLatency';

export function isAudioLatencyProfile(value: unknown): value is AudioLatencyProfile {
    return AUDIO_LATENCY_PROFILES.some((profile) => profile === value);
}

export function getAudioContextLatencyHint(profile: AudioLatencyProfile): 'interactive' | 'playback' {
    if (profile === 'highCapacity') {
        return 'playback';
    }
    return 'interactive';
}

export function readStoredAudioLatencyProfile(): AudioLatencyProfile {
    const storage = createLocalStorage<unknown>('sourdaw-preferences');
    try {
        if (!storage.isSupported()) {
            return DEFAULT_AUDIO_LATENCY_PROFILE;
        }
        const stored = storage.get();
        if (typeof stored !== 'object' || stored === null || !('audioLatencyProfile' in stored)) {
            return DEFAULT_AUDIO_LATENCY_PROFILE;
        }
        const profile = stored.audioLatencyProfile;
        return isAudioLatencyProfile(profile) ? profile : DEFAULT_AUDIO_LATENCY_PROFILE;
    } catch {
        return DEFAULT_AUDIO_LATENCY_PROFILE;
    }
}
