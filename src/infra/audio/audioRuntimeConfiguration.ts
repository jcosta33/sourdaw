import { DEFAULT_AUDIO_LATENCY_PROFILE, type AudioLatencyProfile } from './AudioLatencyProfile';

let configuredLatencyProfile: AudioLatencyProfile | null = null;

export const audioRuntimeConfiguration = {
    configureLatencyProfile(profile: AudioLatencyProfile): void {
        if (configuredLatencyProfile !== null && configuredLatencyProfile !== profile) {
            throw new Error('Audio latency profile is already configured for this application runtime.');
        }
        configuredLatencyProfile = profile;
    },
    get latencyProfile(): AudioLatencyProfile {
        if (configuredLatencyProfile === null) {
            configuredLatencyProfile = DEFAULT_AUDIO_LATENCY_PROFILE;
        }
        return configuredLatencyProfile;
    },
};
