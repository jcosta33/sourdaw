import { trackStore } from '#/modules/Arrangement/stores';
import { type FrequencyBand, type MixAnalysis } from '#/modules/AudioAnalysis/models/MixComparisonTypes';

function estimateFrequencyProfile(tracks: Array<{ kind: string; gain?: number }>): Record<FrequencyBand, number> {
    const profile: Record<FrequencyBand, number> = {
        sub: 0.3,
        bass: 0.5,
        'low-mid': 0.6,
        mid: 0.7,
        'high-mid': 0.6,
        presence: 0.5,
        air: 0.3,
    };

    const midiTracks = tracks.filter((time) => time.kind === 'midi').length;
    const audioTracks = tracks.filter((time) => time.kind === 'audio').length;
    const totalTracks = tracks.length || 1;

    if (midiTracks / totalTracks > 0.5) {
        profile.mid += 0.15;
        profile['high-mid'] += 0.1;
    }
    if (audioTracks / totalTracks > 0.5) {
        profile.bass += 0.1;
        profile['low-mid'] += 0.1;
    }

    const max = Math.max(...Object.values(profile));
    for (const band of Object.keys(profile) as FrequencyBand[]) {
        profile[band] = Math.min(1, profile[band] / max);
    }

    return profile;
}

function createDefaultAnalysis(): MixAnalysis {
    return {
        rmsDb: -18,
        peakDb: -6,
        lufs: -14,
        frequencyProfile: { sub: 0.3, bass: 0.5, 'low-mid': 0.6, mid: 0.7, 'high-mid': 0.6, presence: 0.5, air: 0.3 },
        stereoWidth: 0.5,
        dynamicRange: 10,
        crestFactor: 7,
    };
}

/**
 * Analyze a mix based on track configuration.
 * In production this would use actual audio analysis;
 * here we derive estimates from track gain/pan/device settings.
 */
export function analyzeMix(): MixAnalysis {
    const state = trackStore.value;
    if (!state) {
        return createDefaultAnalysis();
    }

    const tracks = state.tracks.filter((time) => !time.muted && time.kind !== 'folder');
    const trackCount = tracks.length || 1;

    const gains = tracks.map((time) => time.gain ?? 0);
    const avgGain = gains.reduce((alpha, b) => alpha + b, 0) / trackCount;
    const rmsDb = Math.max(-60, avgGain - 6);
    const peakDb = Math.max(-60, avgGain - 1);
    const lufs = rmsDb - 3;

    const frequencyProfile = estimateFrequencyProfile(tracks);

    const pans = tracks.map((time) => Math.abs(time.pan ?? 0));
    const stereoWidth = pans.length > 0 ? pans.reduce((alpha, b) => alpha + b, 0) / pans.length : 0.5;

    const dynamicRange = Math.min(20, Math.max(3, 14 - trackCount * 0.5));
    const crestFactor = dynamicRange * 0.7;

    return { rmsDb, peakDb, lufs, frequencyProfile, stereoWidth, dynamicRange, crestFactor };
}
