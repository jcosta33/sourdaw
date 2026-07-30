import { DEFAULT_AUDIO_LATENCY_PROFILE, type AudioLatencyProfile } from './AudioLatencyProfile';

type ResolveAudioLatencyProfileInput = {
    requestedProfile: unknown;
    persistedProfile: unknown;
};

function isAudioLatencyProfile(value: unknown): value is AudioLatencyProfile {
    return value === 'low-latency' || value === 'high-capacity';
}

export function resolveAudioLatencyProfile({
    requestedProfile,
    persistedProfile,
}: ResolveAudioLatencyProfileInput): AudioLatencyProfile {
    if (isAudioLatencyProfile(requestedProfile)) {
        return requestedProfile;
    }
    if (isAudioLatencyProfile(persistedProfile)) {
        return persistedProfile;
    }
    return DEFAULT_AUDIO_LATENCY_PROFILE;
}
