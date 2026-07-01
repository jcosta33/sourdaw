/**
 * Device node factory — creates and wires Web Audio nodes for built-in
 * DAW effects. Each device type is implemented in ./devices/*.ts.
 *
 * Public surface:
 *   - `createOfflineDeviceNode` — resolve and create a built-in device node
 *   - `OfflineDeviceNode` — shared node-graph descriptor
 */

import { createCompressor } from './devices/dynamics/createCompressor';
import { createEq } from './devices/dynamics/createEq';
import { createLimiter } from './devices/dynamics/createLimiter';
import { createSidechainCompressorFallback } from './devices/dynamics/createSidechainCompressorFallback';
import { createAutoPan } from './devices/modulation/createAutoPan';
import { createChorus } from './devices/modulation/createChorus';
import { createFlanger } from './devices/modulation/createFlanger';
import { createPhaser } from './devices/modulation/createPhaser';
import { createStereoWidener } from './devices/modulation/createStereoWidener';
import { createTremolo } from './devices/modulation/createTremolo';
import { createConvolutionReverb } from './devices/reverbDelay/createConvolutionReverb';
import { createDelay } from './devices/reverbDelay/createDelay';
import { createReverb } from './devices/reverbDelay/createReverb';
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
