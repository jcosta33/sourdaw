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
import { createEq } from './devices/dynamics/createEq';
import { applyEqParams } from './devices/dynamics/applyEqParams';
import { createCompressor } from './devices/dynamics/createCompressor';
import { applyCompressorParams } from './devices/dynamics/applyCompressorParams';
import { createSidechainCompressorFallback } from './devices/dynamics/createSidechainCompressorFallback';
import { applySidechainCompressorParams } from './devices/dynamics/applySidechainCompressorParams';
import { createLimiter } from './devices/dynamics/createLimiter';
import { applyLimiterParams } from './devices/dynamics/applyLimiterParams';
import { createReverb } from './devices/reverbDelay/createReverb';
import { applyReverbParams } from './devices/reverbDelay/applyReverbParams';
import { createDelay } from './devices/reverbDelay/createDelay';
import { applyDelayParams } from './devices/reverbDelay/applyDelayParams';
import { createConvolutionReverb } from './devices/reverbDelay/createConvolutionReverb';
import { applyConvolutionReverbParams } from './devices/reverbDelay/applyConvolutionReverbParams';
import { createGainDevice } from './devices/toneShaping/createGainDevice';
import { applyGainParams } from './devices/toneShaping/applyGainParams';
import { createFilter } from './devices/toneShaping/createFilter';
import { applyFilterParams } from './devices/toneShaping/applyFilterParams';
import { createDistortion } from './devices/toneShaping/createDistortion';
import { applyDistortionParams } from './devices/toneShaping/applyDistortionParams';
import { createBitcrusher } from './devices/toneShaping/createBitcrusher';
import { applyBitcrusherParams } from './devices/toneShaping/applyBitcrusherParams';
import { createDeEsser } from './devices/toneShaping/createDeEsser';
import { applyDeEsserParams } from './devices/toneShaping/applyDeEsserParams';
import { createLufsMeter } from './devices/toneShaping/createLufsMeter';
import { createChorus } from './devices/modulation/createChorus';
import { applyChorusParams } from './devices/modulation/applyChorusParams';
import { createPhaser } from './devices/modulation/createPhaser';
import { applyPhaserParams } from './devices/modulation/applyPhaserParams';
import { createFlanger } from './devices/modulation/createFlanger';
import { applyFlangerParams } from './devices/modulation/applyFlangerParams';
import { createTremolo } from './devices/modulation/createTremolo';
import { applyTremoloParams } from './devices/modulation/applyTremoloParams';
import { createAutoPan } from './devices/modulation/createAutoPan';
import { applyAutoPanParams } from './devices/modulation/applyAutoPanParams';
import { createStereoWidener } from './devices/modulation/createStereoWidener';
import { applyStereoWidenerParams } from './devices/modulation/applyStereoWidenerParams';

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

const PARAM_APPLIERS: Record<string, (dn: OfflineDeviceNode, params: Record<string, number>) => void> = {
    'builtin-eq': applyEqParams,
    'builtin-compressor': applyCompressorParams,
    'builtin-sidechain-compressor': applySidechainCompressorParams,
    'builtin-limiter': applyLimiterParams,
    'builtin-reverb': applyReverbParams,
    'builtin-delay': applyDelayParams,
    'builtin-convolution-reverb': applyConvolutionReverbParams,
    'builtin-gain': applyGainParams,
    'builtin-filter': applyFilterParams,
    'builtin-distortion': applyDistortionParams,
    'builtin-bitcrusher': applyBitcrusherParams,
    'builtin-deesser': applyDeEsserParams,
    // builtin-lufs-meter intentionally omitted — pass-through analyser, no audio params
    'builtin-chorus': applyChorusParams,
    'builtin-phaser': applyPhaserParams,
    'builtin-flanger': applyFlangerParams,
    'builtin-tremolo': applyTremoloParams,
    'builtin-autopan': applyAutoPanParams,
    'builtin-stereo-widener': applyStereoWidenerParams,
};

export function applyParams(dn: OfflineDeviceNode, deviceType: string, params: Record<string, number>): void {
    PARAM_APPLIERS[deviceType]?.(dn, params);
}
