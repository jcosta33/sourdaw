import { dbToGain } from '#/utils/audioLevelLaw';

import { FLANGER_MIN_DELAY_SECONDS } from '../models/DeviceParamLaws';
import { getDrumKitByIndex } from '../models/FactoryDrumKits';
import { type OfflineDeviceNode } from '../models/OfflineDeviceNode';
import { type DrumKit } from '../models/SynthModels';

export function resolveDrumKit(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null {
    const kitDevice = devices.find(
        (data) => data.type === 'builtin-drum-kit' || data.type.startsWith('builtin-drum-machine')
    );
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitByIndex(kitIndex);
}

export function resolveDeviceParam(
    deviceType: string,
    parameterId: string,
    node: OfflineDeviceNode
): AudioParam | null {
    return resolveDeviceParamTargets(deviceType, parameterId, node)[0]?.audioParam ?? null;
}

type DeviceParamTargetDefinition = {
    nodeName?: string;
    nodeIndex?: number;
    property?: string;
    /**
     * AudioWorkletNode AudioParam-map lookup, for targets that only exist as
     * worklet parameters (`node.parameters.get(name)`), not as properties.
     */
    paramName?: string;
    scale?: number;
    offset?: number;
    /**
     * The device→AudioParam conversion the parameter's static applier applies,
     * for laws the affine `scale`/`offset` pair cannot express — dB→linear
     * gain, or a floor such as the flanger's minimum delay. The offline
     * scheduler slews, clamps and quantises in device units and runs this once
     * per emitted sample, exactly where live's `updateDeviceParam` converts
     * (issue #3738). Must be kept identical to the applier's own conversion;
     * shared constants come from `models/DeviceParamLaws.ts`.
     */
    convert?: (deviceValue: number) => number;
};

export type ResolvedDeviceParamTarget = {
    audioParam: AudioParam;
    scale: number;
    offset: number;
    convert?: (deviceValue: number) => number;
};

/**
 * Every offline-automatable built-in Web Audio control, resolved against the
 * same graphs the device factories build and the same laws their static
 * appliers apply. Controls whose DSP has no AudioParam home (impulse and
 * curve regeneration) are deliberately absent — the offline automation
 * binding census carries those rows with reasons.
 */
const paramTargetMap: Record<string, readonly DeviceParamTargetDefinition[]> = {
    'builtin-eq:eq-low-gain': [{ nodeIndex: 0, property: 'gain' }],
    'builtin-eq:eq-low-freq': [{ nodeIndex: 0, property: 'frequency' }],
    'builtin-eq:eq-low-q': [{ nodeIndex: 0, property: 'Q' }],
    'builtin-eq:eq-mid-gain': [{ nodeIndex: 1, property: 'gain' }],
    'builtin-eq:eq-mid-freq': [{ nodeIndex: 1, property: 'frequency' }],
    'builtin-eq:eq-mid-q': [{ nodeIndex: 1, property: 'Q' }],
    'builtin-eq:eq-high-gain': [{ nodeIndex: 2, property: 'gain' }],
    'builtin-eq:eq-high-freq': [{ nodeIndex: 2, property: 'frequency' }],
    'builtin-eq:eq-high-q': [{ nodeIndex: 2, property: 'Q' }],
    'builtin-compressor:comp-threshold': [{ nodeIndex: 0, property: 'threshold' }],
    'builtin-compressor:comp-ratio': [{ nodeIndex: 0, property: 'ratio' }],
    // Descriptor times are milliseconds; the compressor's are seconds.
    'builtin-compressor:comp-attack': [{ nodeIndex: 0, property: 'attack', scale: 1 / 1000 }],
    'builtin-compressor:comp-release': [{ nodeIndex: 0, property: 'release', scale: 1 / 1000 }],
    'builtin-compressor:comp-knee': [{ nodeIndex: 0, property: 'knee' }],
    // Makeup is a dB knob over a linear gain node — the applier's dB→linear law.
    'builtin-compressor:comp-makeup': [{ nodeIndex: 1, property: 'gain', convert: dbToGain }],
    // Sidechain compressor. The offline fallback graph is the compressor
    // factory's; a prepared offline sidechain builds the worklet, whose
    // parameters live in its AudioParamMap with the applier's own laws
    // (attack/release in seconds, makeup in raw dB). Each definition family
    // resolves only on the graph it names, so a node never receives both.
    'builtin-sidechain-compressor:sc-comp-threshold': [
        { nodeIndex: 0, property: 'threshold' },
        { paramName: 'threshold' },
    ],
    'builtin-sidechain-compressor:sc-comp-ratio': [{ nodeIndex: 0, property: 'ratio' }, { paramName: 'ratio' }],
    'builtin-sidechain-compressor:sc-comp-attack': [
        { nodeIndex: 0, property: 'attack', scale: 1 / 1000 },
        { paramName: 'attack', scale: 1 / 1000 },
    ],
    'builtin-sidechain-compressor:sc-comp-release': [
        { nodeIndex: 0, property: 'release', scale: 1 / 1000 },
        { paramName: 'release', scale: 1 / 1000 },
    ],
    // The worklet's makeup is a raw dB number; the fallback's is a linear gain.
    'builtin-sidechain-compressor:sc-comp-makeup': [
        { nodeIndex: 1, property: 'gain', convert: dbToGain },
        { paramName: 'makeup' },
    ],
    // rev-size/rev-decay/rev-damping re-render the impulse (no AudioParam).
    'builtin-reverb:rev-predelay': [{ nodeName: 'predelay', property: 'delayTime', scale: 1 / 1000 }],
    'builtin-reverb:rev-lowcut': [{ nodeName: 'lowcut', property: 'frequency' }],
    // The wet/dry pair follows applyReverbParams' law: wet = mix, dry = 1 − mix.
    'builtin-reverb:rev-mix': [
        { nodeName: 'wet', property: 'gain' },
        { nodeName: 'dry', property: 'gain', scale: -1, offset: 1 },
    ],
    'builtin-delay:delay-time': [{ nodeIndex: 3, property: 'delayTime', scale: 1 / 1000 }],
    'builtin-delay:delay-feedback': [{ nodeIndex: 4, property: 'gain' }],
    'builtin-delay:delay-lowcut': [{ nodeIndex: 6, property: 'frequency' }],
    'builtin-delay:delay-highcut': [{ nodeIndex: 7, property: 'frequency' }],
    'builtin-delay:delay-mix': [
        { nodeIndex: 2, property: 'gain' },
        { nodeIndex: 1, property: 'gain', scale: -1, offset: 1 },
    ],
    'builtin-gain:gain-level': [{ nodeIndex: 0, property: 'gain', convert: dbToGain }],
    'builtin-limiter:lim-threshold': [{ nodeName: 'comp', property: 'threshold' }],
    'builtin-limiter:lim-release': [{ nodeName: 'comp', property: 'release', scale: 1 / 1000 }],
    // lim-ceiling binds nothing: the advertised cap lives in the clipper's
    // WaveShaper curve, which only static writes rebuild — automating the
    // ceiling gain alone left the factory curve in place and rendered peaks
    // past the knob's ceiling. The census carries the reasoned exemption.
    'builtin-filter:filter-cutoff': [{ nodeName: 'filter', property: 'frequency' }],
    'builtin-filter:filter-resonance': [{ nodeName: 'filter', property: 'Q' }],
    // dist-drive regenerates the WaveShaper curve (no AudioParam).
    'builtin-distortion:dist-tone': [{ nodeName: 'tone', property: 'frequency' }],
    'builtin-distortion:dist-output': [{ nodeName: 'outputLevel', property: 'gain', convert: dbToGain }],
    'builtin-distortion:dist-mix': [
        { nodeName: 'wet', property: 'gain' },
        { nodeName: 'dry', property: 'gain', scale: -1, offset: 1 },
    ],
    // crush-bits regenerates the WaveShaper curve; crush-rate lives on the
    // rate decimator worklet the graph only sometimes carries.
    'builtin-bitcrusher:crush-rate': [{ nodeIndex: 5, paramName: 'rate' }],
    'builtin-bitcrusher:crush-mix': [
        { nodeIndex: 2, property: 'gain' },
        { nodeIndex: 1, property: 'gain', scale: -1, offset: 1 },
    ],
    // The threshold enters the sidechain as a linear subtractor: the envelope
    // sum carries −10^(threshold/20) (see createDeEsser), so automation must
    // convert exactly the way the static applier writes.
    'builtin-deesser:deess-threshold': [
        { nodeName: 'threshLin', property: 'offset', convert: (value) => -dbToGain(value) },
    ],
    'builtin-deesser:deess-freq': [{ nodeName: 'bandpass', property: 'frequency' }],
    // Both band taps carry 1 − 10^(range/20): the reduction limit and the
    // cancellation weight are the same law (see createDeEsser).
    'builtin-deesser:deess-range': [
        { nodeName: 'wet', property: 'gain', convert: (value) => 1 - dbToGain(value) },
        { nodeName: 'cancel', property: 'gain', convert: (value) => dbToGain(value) - 1 },
    ],
    'builtin-convolution-reverb:conv-mix': [
        { nodeIndex: 2, property: 'gain' },
        { nodeIndex: 1, property: 'gain', scale: -1, offset: 1 },
    ],
    'builtin-convolution-reverb:conv-predelay': [{ nodeIndex: 5, property: 'delayTime', scale: 1 / 1000 }],
    'builtin-convolution-reverb:conv-lowcut': [{ nodeIndex: 6, property: 'frequency' }],
    'builtin-convolution-reverb:conv-highcut': [{ nodeIndex: 7, property: 'frequency' }],
    'builtin-chorus:chorus-rate': [
        { nodeName: 'lfo1', property: 'frequency' },
        { nodeName: 'lfo2', property: 'frequency', scale: 1.2 },
    ],
    'builtin-chorus:chorus-depth': [
        { nodeName: 'lfoGain1', property: 'gain', scale: 1 / 1000 },
        { nodeName: 'lfoGain2', property: 'gain', scale: 1 / 1000 },
    ],
    'builtin-chorus:chorus-feedback': [{ nodeName: 'feedback', property: 'gain' }],
    'builtin-chorus:chorus-mix': [
        { nodeName: 'wet', property: 'gain' },
        { nodeName: 'dry', property: 'gain', scale: -1, offset: 1 },
    ],
    'builtin-phaser:phaser-rate': [{ nodeName: 'lfo', property: 'frequency' }],
    'builtin-phaser:phaser-depth': [
        { nodeName: 'lfoGain', property: 'gain', scale: 1000 },
        { nodeName: 'wet', property: 'gain', scale: 0.5, offset: 0.25 },
        { nodeName: 'dry', property: 'gain', scale: -0.5, offset: 0.75 },
    ],
    'builtin-phaser:phaser-feedback': [{ nodeName: 'feedback', property: 'gain' }],
    'builtin-flanger:flanger-rate': [{ nodeName: 'lfo', property: 'frequency' }],
    'builtin-flanger:flanger-depth': [
        { nodeName: 'lfoGain', property: 'gain', scale: 1 / 1000 },
        {
            nodeName: 'delay',
            property: 'delayTime',
            convert: (value) => Math.max(FLANGER_MIN_DELAY_SECONDS, value / 1000),
        },
    ],
    'builtin-flanger:flanger-feedback': [{ nodeName: 'feedback', property: 'gain' }],
    'builtin-flanger:flanger-mix': [
        { nodeName: 'wet', property: 'gain' },
        { nodeName: 'dry', property: 'gain', scale: -1, offset: 1 },
    ],
    'builtin-tremolo:trem-rate': [{ nodeName: 'lfo', property: 'frequency' }],
    'builtin-tremolo:trem-depth': [{ nodeName: 'lfoDepth', property: 'gain' }],
    'builtin-autopan:autopan-rate': [{ nodeName: 'lfo', property: 'frequency' }],
    'builtin-autopan:autopan-depth': [
        { nodeName: 'lfoGainL', property: 'gain', scale: 0.5 },
        { nodeName: 'lfoGainR', property: 'gain', scale: -0.5 },
    ],
    'builtin-stereo-widener:width-amount': [{ nodeName: 'sideGain', property: 'gain' }],
    'builtin-stereo-widener:width-mid': [{ nodeName: 'midGain', property: 'gain', convert: dbToGain }],
    'builtin-stereo-widener:width-side': [{ nodeName: 'sideLevel', property: 'gain', convert: dbToGain }],
    'builtin-stereo-widener:width-mono-bass': [{ nodeName: 'monoBassFilter', property: 'frequency' }],
};

function isAudioParam(value: unknown): value is AudioParam {
    return typeof value === 'object' && value !== null && 'value' in value;
}

function resolveTargetNode(node: OfflineDeviceNode, definition: DeviceParamTargetDefinition): AudioNode | undefined {
    if (definition.nodeName) {
        return node.namedNodes?.[definition.nodeName];
    }
    if (definition.nodeIndex !== undefined) {
        return node.nodes[definition.nodeIndex];
    }
    return undefined;
}

function resolveDefinitionParam(targetNode: AudioNode, definition: DeviceParamTargetDefinition): unknown {
    if (definition.paramName !== undefined) {
        const parameters = (targetNode as { parameters?: AudioParamMap }).parameters;
        return parameters?.get(definition.paramName) ?? null;
    }
    if (definition.property !== undefined) {
        return Reflect.get(targetNode, definition.property);
    }
    return null;
}

export function resolveDeviceParamTargets(
    deviceType: string,
    parameterId: string,
    node: OfflineDeviceNode
): ResolvedDeviceParamTarget[] {
    const definitions = paramTargetMap[`${deviceType}:${parameterId}`] ?? [];
    const targets: ResolvedDeviceParamTarget[] = [];
    for (const definition of definitions) {
        const targetNode = resolveTargetNode(node, definition);
        const candidate: unknown = targetNode ? resolveDefinitionParam(targetNode, definition) : null;
        if (isAudioParam(candidate)) {
            targets.push({
                audioParam: candidate,
                scale: definition.scale ?? 1,
                offset: definition.offset ?? 0,
                convert: definition.convert,
            });
        }
    }
    return targets;
}

export function resolveDeviceParamScale(deviceType: string, parameterId: string): number {
    return paramTargetMap[`${deviceType}:${parameterId}`]?.[0]?.scale ?? 1;
}
