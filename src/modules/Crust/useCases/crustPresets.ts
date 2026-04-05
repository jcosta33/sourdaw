/**
 * Crust factory presets.
 */
import { type CrustPatch, DEFAULT_CRUST_PATCH } from '../models/CrustPatch';

export type CrustPreset = {
    id: string;
    name: string;
    category: string;
    patch: CrustPatch;
};

function preset(id: string, name: string, category: string, overrides: Partial<CrustPatch>): CrustPreset {
    return { id, name, category, patch: { ...DEFAULT_CRUST_PATCH, name, ...overrides } };
}

export const CRUST_PRESETS: CrustPreset[] = [
    preset('transparent-master', 'Transparent Master', 'Mastering', {
        algorithm: 'transparent',
        gain: 0,
        ceiling: -0.3,
        oversampling: 8,
        lookahead: 2,
    }),
    preset('punchy-bus', 'Punchy Bus', 'Bus', {
        algorithm: 'punchy',
        gain: 2,
        ceiling: -0.3,
        channelLinkTransient: 80,
        channelLinkRelease: 100,
    }),
    preset('allround-streaming', 'Allround Streaming', 'Mastering', {
        algorithm: 'allround',
        gain: 3,
        ceiling: -1.0,
        streamingPreset: 'spotify',
    }),
    preset('loud-club', 'Loud Club', 'Mastering', {
        algorithm: 'aggressive',
        gain: 6,
        ceiling: -0.3,
        oversampling: 4,
        satEnabled: true,
        satAlgorithm: 'tape',
        satDrive: 4,
        satMix: 30,
    }),
    preset('broadcast-ebu', 'Broadcast EBU R128', 'Broadcast', {
        algorithm: 'wall',
        gain: 0,
        ceiling: -1.0,
        streamingPreset: 'ebu_r128',
        truePeak: true,
        oversampling: 16,
    }),
    preset('safe-acoustic', 'Safe Acoustic', 'Mastering', {
        algorithm: 'safe',
        gain: 0.5,
        ceiling: -0.5,
        truePeak: true,
        attackAuto: true,
        releaseAuto: true,
    }),
    preset('warm-analog', 'Warm Analog', 'Creative', {
        algorithm: 'allround',
        gain: 2,
        ceiling: -0.3,
        satEnabled: true,
        satAlgorithm: 'tube',
        satDrive: 6,
        satMix: 50,
    }),
    preset('dynamic-rock', 'Dynamic Rock', 'Bus', {
        algorithm: 'dynamic',
        gain: 3,
        ceiling: -0.3,
        channelLinkTransient: 60,
    }),
];
