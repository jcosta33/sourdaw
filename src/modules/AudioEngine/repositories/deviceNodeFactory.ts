/**
 * Device node factory — creates and wires Web Audio nodes for built-in
 * DAW effects. Each device type is implemented in ./devices/*.ts.
 *
 * Public surface:
 *   - `createOfflineDeviceNode` — resolve and create a built-in device node
 *   - `OfflineDeviceNode` — shared node-graph descriptor
 */

import {
    SIDECHAIN_COMPRESSOR_RUNTIME_STRATEGY,
    type BuiltinDeviceRuntimeStrategy,
} from '../models/BuiltinDeviceRuntime';

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

type BuiltinDeviceNodeFactory = {
    readonly type: string;
    readonly create: (ctx: BaseAudioContext, device?: object) => OfflineDeviceNode;
    readonly runtime: BuiltinDeviceRuntimeStrategy;
};

const STANDARD_WEB_AUDIO_RUNTIME_STRATEGY: BuiltinDeviceRuntimeStrategy = {
    live: {
        source: 'AudioEngine.deviceNodeFactory',
        ports: {
            inputs: 1,
            outputs: 1,
            channelsPerPort: 2,
            externalInputs: 0,
            sidechainRouting: 'not-applicable',
        },
        notes: { availability: 'unavailable' },
        // A factory with no latency reporter has the PDC default, not a certified
        // zero-latency measurement.
        latency: { kind: 'pdc-default-zero' },
    },
    offline: {
        source: 'AudioEngine.deviceNodeFactory',
        availability: 'available',
    },
};

export const BUILTIN_DEVICE_NODE_FACTORIES: readonly BuiltinDeviceNodeFactory[] = [
    { type: 'builtin-eq', create: createEq, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-compressor', create: createCompressor, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    {
        type: 'builtin-sidechain-compressor',
        create: createSidechainCompressorFallback,
        runtime: SIDECHAIN_COMPRESSOR_RUNTIME_STRATEGY,
    },
    { type: 'builtin-limiter', create: createLimiter, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-reverb', create: createReverb, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-delay', create: createDelay, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    {
        type: 'builtin-convolution-reverb',
        create: createConvolutionReverb,
        runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY,
    },
    { type: 'builtin-gain', create: createGainDevice, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-filter', create: createFilter, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-distortion', create: createDistortion, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-bitcrusher', create: createBitcrusher, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-deesser', create: createDeEsser, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-lufs-meter', create: createLufsMeter, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-chorus', create: createChorus, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-phaser', create: createPhaser, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-flanger', create: createFlanger, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-tremolo', create: createTremolo, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-autopan', create: createAutoPan, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
    { type: 'builtin-stereo-widener', create: createStereoWidener, runtime: STANDARD_WEB_AUDIO_RUNTIME_STRATEGY },
];

type CreateOfflineDeviceNodeInput = {
    context: BaseAudioContext;
    device?: object;
    deviceType: string;
};

type CreateOfflineDeviceNodeOutput = OfflineDeviceNode | null;

export function createOfflineDeviceNode({
    context,
    device,
    deviceType,
}: CreateOfflineDeviceNodeInput): CreateOfflineDeviceNodeOutput {
    const factory = BUILTIN_DEVICE_NODE_FACTORIES.find((candidate) => candidate.type === deviceType);
    if (!factory) {
        return null;
    }

    return factory.create(context, device);
}
