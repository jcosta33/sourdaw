/**
 * Device node factory — creates and wires Web Audio nodes for built-in
 * DAW effects. Each device type is implemented in ./devices/*.ts.
 *
 * Public surface:
 *   - `DEVICE_FACTORIES` — map of deviceType → factory function
 *   - `applyParams` — apply a parameter map to an existing device node
 *   - `OfflineDeviceNode` — shared node-graph descriptor
 */

import { type OfflineDeviceNode } from './devices/types';
import {
    createEq, applyEqParams,
    createCompressor, applyCompressorParams,
    createSidechainCompressorFallback, applySidechainCompressorParams,
    createLimiter, applyLimiterParams,
} from './devices/dynamics';
import {
    createReverb, applyReverbParams,
    createDelay, applyDelayParams,
    createConvolutionReverb, applyConvolutionReverbParams,
} from './devices/reverbDelay';
import {
    createGainDevice, applyGainParams,
    createFilter, applyFilterParams,
    createDistortion, applyDistortionParams,
    createBitcrusher, applyBitcrusherParams,
    createDeEsser, applyDeEsserParams,
    createLufsMeter,
} from './devices/toneShaping';
import {
    createChorus, applyChorusParams,
    createPhaser, applyPhaserParams,
    createFlanger, applyFlangerParams,
    createTremolo, applyTremoloParams,
    createAutoPan, applyAutoPanParams,
    createStereoWidener, applyStereoWidenerParams,
} from './devices/modulation';

export type { OfflineDeviceNode };

// ── Factory map ──────────────────────────────────────────────────────────

export const DEVICE_FACTORIES: Record<string, (ctx: BaseAudioContext) => OfflineDeviceNode> = {
    'builtin-eq': createEq,
    'builtin-compressor': createCompressor,
    'builtin-sidechain-compressor': createSidechainCompressorFallback,
    'builtin-limiter': createLimiter,
    'builtin-reverb': createReverb,
    'builtin-delay': createDelay,
    'builtin-convolution-reverb': createConvolutionReverb,
    'builtin-gain': createGainDevice,
    'builtin-filter': createFilter,
    'builtin-distortion': createDistortion,
    'builtin-bitcrusher': createBitcrusher,
    'builtin-deesser': createDeEsser,
    'builtin-lufs-meter': createLufsMeter,
    'builtin-chorus': createChorus,
    'builtin-phaser': createPhaser,
    'builtin-flanger': createFlanger,
    'builtin-tremolo': createTremolo,
    'builtin-autopan': createAutoPan,
    'builtin-stereo-widener': createStereoWidener,
};

// ── Parameter application dispatch ───────────────────────────────────────

export function applyParams(dn: OfflineDeviceNode, deviceType: string, params: Record<string, number>): void {
    switch (deviceType) {
        case 'builtin-eq': applyEqParams(dn, params); break;
        case 'builtin-compressor': applyCompressorParams(dn, params); break;
        case 'builtin-sidechain-compressor': applySidechainCompressorParams(dn, params); break;
        case 'builtin-limiter': applyLimiterParams(dn, params); break;
        case 'builtin-reverb': applyReverbParams(dn, params); break;
        case 'builtin-delay': applyDelayParams(dn, params); break;
        case 'builtin-convolution-reverb': applyConvolutionReverbParams(dn, params); break;
        case 'builtin-gain': applyGainParams(dn, params); break;
        case 'builtin-filter': applyFilterParams(dn, params); break;
        case 'builtin-distortion': applyDistortionParams(dn, params); break;
        case 'builtin-bitcrusher': applyBitcrusherParams(dn, params); break;
        case 'builtin-deesser': applyDeEsserParams(dn, params); break;
        case 'builtin-lufs-meter': break; // pass-through analyser, no audio params
        case 'builtin-chorus': applyChorusParams(dn, params); break;
        case 'builtin-phaser': applyPhaserParams(dn, params); break;
        case 'builtin-flanger': applyFlangerParams(dn, params); break;
        case 'builtin-tremolo': applyTremoloParams(dn, params); break;
        case 'builtin-autopan': applyAutoPanParams(dn, params); break;
        case 'builtin-stereo-widener': applyStereoWidenerParams(dn, params); break;
    }
}
