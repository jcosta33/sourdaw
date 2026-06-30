/**
 * Device node factory — creates and wires Web Audio nodes for built-in
 * DAW effects. Each device type is implemented in ./devices/*.ts.
 *
 * Public surface:
 *   - `createOfflineDeviceNode` — resolve and create a built-in device node
 *   - `applyParams` — apply a parameter map to an existing device node
 *   - `OfflineDeviceNode` — shared node-graph descriptor
 */

import { applyCompressorParams } from './devices/dynamics/applyCompressorParams';
import { applyEqParams } from './devices/dynamics/applyEqParams';
import { applyLimiterParams } from './devices/dynamics/applyLimiterParams';
import { applySidechainCompressorParams } from './devices/dynamics/applySidechainCompressorParams';
import { createCompressor } from './devices/dynamics/createCompressor';
import { createEq } from './devices/dynamics/createEq';
import { createLimiter } from './devices/dynamics/createLimiter';
import { createSidechainCompressorFallback } from './devices/dynamics/createSidechainCompressorFallback';
import { applyAutoPanParams } from './devices/modulation/applyAutoPanParams';
import { applyChorusParams } from './devices/modulation/applyChorusParams';
import { applyFlangerParams } from './devices/modulation/applyFlangerParams';
import { applyPhaserParams } from './devices/modulation/applyPhaserParams';
import { applyStereoWidenerParams } from './devices/modulation/applyStereoWidenerParams';
import { applyTremoloParams } from './devices/modulation/applyTremoloParams';
import { createAutoPan } from './devices/modulation/createAutoPan';
import { createChorus } from './devices/modulation/createChorus';
import { createFlanger } from './devices/modulation/createFlanger';
import { createPhaser } from './devices/modulation/createPhaser';
import { createStereoWidener } from './devices/modulation/createStereoWidener';
import { createTremolo } from './devices/modulation/createTremolo';
import { applyConvolutionReverbParams } from './devices/reverbDelay/applyConvolutionReverbParams';
import { applyDelayParams } from './devices/reverbDelay/applyDelayParams';
import { applyReverbParams } from './devices/reverbDelay/applyReverbParams';
import { createConvolutionReverb } from './devices/reverbDelay/createConvolutionReverb';
import { createDelay } from './devices/reverbDelay/createDelay';
import { createReverb } from './devices/reverbDelay/createReverb';
import { applyBitcrusherParams } from './devices/toneShaping/applyBitcrusherParams';
import { applyDeEsserParams } from './devices/toneShaping/applyDeEsserParams';
import { applyDistortionParams } from './devices/toneShaping/applyDistortionParams';
import { applyFilterParams } from './devices/toneShaping/applyFilterParams';
import { applyGainParams } from './devices/toneShaping/applyGainParams';
import { createBitcrusher } from './devices/toneShaping/createBitcrusher';
import { createDeEsser } from './devices/toneShaping/createDeEsser';
import { createDistortion } from './devices/toneShaping/createDistortion';
import { createFilter } from './devices/toneShaping/createFilter';
import { createGainDevice } from './devices/toneShaping/createGainDevice';
import { createLufsMeter } from './devices/toneShaping/createLufsMeter';
import { type OfflineDeviceNode } from './devices/types';

export type { OfflineDeviceNode };

// ── Factory map ──────────────────────────────────────────────────────────

const DEVICE_FACTORIES: Record<string, (ctx: BaseAudioContext) => OfflineDeviceNode> = {
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

type CreateOfflineDeviceNodeInput = {
    context: BaseAudioContext;
    deviceType: string;
};

type CreateOfflineDeviceNodeOutput = OfflineDeviceNode | null;

export function createOfflineDeviceNode({
    context,
    deviceType,
}: CreateOfflineDeviceNodeInput): CreateOfflineDeviceNodeOutput {
    const factory = DEVICE_FACTORIES[deviceType];
    if (!factory) {
        return null;
    }

    return factory(context);
}

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
