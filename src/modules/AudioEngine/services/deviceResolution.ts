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
    property: string;
    scale?: number;
    offset?: number;
};

export type ResolvedDeviceParamTarget = {
    audioParam: AudioParam;
    scale: number;
    offset: number;
};

const paramTargetMap: Record<string, readonly DeviceParamTargetDefinition[]> = {
    'builtin-eq:eq-low-gain': [{ nodeIndex: 0, property: 'gain' }],
    'builtin-eq:eq-low-freq': [{ nodeIndex: 0, property: 'frequency' }],
    'builtin-eq:eq-mid-gain': [{ nodeIndex: 1, property: 'gain' }],
    'builtin-eq:eq-mid-freq': [{ nodeIndex: 1, property: 'frequency' }],
    'builtin-eq:eq-mid-q': [{ nodeIndex: 1, property: 'Q' }],
    'builtin-eq:eq-high-gain': [{ nodeIndex: 2, property: 'gain' }],
    'builtin-eq:eq-high-freq': [{ nodeIndex: 2, property: 'frequency' }],
    'builtin-compressor:comp-threshold': [{ nodeIndex: 0, property: 'threshold' }],
    'builtin-compressor:comp-ratio': [{ nodeIndex: 0, property: 'ratio' }],
    'builtin-compressor:comp-attack': [{ nodeIndex: 0, property: 'attack' }],
    'builtin-compressor:comp-release': [{ nodeIndex: 0, property: 'release' }],
    'builtin-compressor:comp-makeup': [{ nodeIndex: 1, property: 'gain' }],
    'builtin-reverb:rev-mix': [{ nodeIndex: 2, property: 'gain' }],
    'builtin-delay:delay-time': [{ nodeIndex: 3, property: 'delayTime', scale: 1 / 1000 }],
    'builtin-delay:delay-feedback': [{ nodeIndex: 4, property: 'gain' }],
    'builtin-delay:delay-mix': [
        { nodeIndex: 2, property: 'gain' },
        { nodeIndex: 1, property: 'gain', scale: -1, offset: 1 },
    ],
    'builtin-gain:gain-level': [{ nodeIndex: 0, property: 'gain' }],
    'builtin-limiter:lim-threshold': [{ nodeIndex: 0, property: 'threshold' }],
    'builtin-limiter:lim-release': [{ nodeIndex: 0, property: 'release' }],
    'builtin-limiter:lim-ceiling': [{ nodeIndex: 1, property: 'gain' }],
    'builtin-filter:filter-cutoff': [{ nodeName: 'filter', property: 'frequency' }],
    'builtin-filter:filter-resonance': [{ nodeName: 'filter', property: 'Q' }],
    'builtin-distortion:dist-mix': [
        { nodeName: 'wet', property: 'gain' },
        { nodeName: 'dry', property: 'gain', scale: -1, offset: 1 },
    ],
    'builtin-autopan:autopan-rate': [{ nodeName: 'lfo', property: 'frequency' }],
    'builtin-autopan:autopan-depth': [
        { nodeName: 'lfoGainL', property: 'gain', scale: 0.5 },
        { nodeName: 'lfoGainR', property: 'gain', scale: -0.5 },
    ],
    'builtin-phaser:phaser-rate': [{ nodeName: 'lfo', property: 'frequency' }],
    'builtin-phaser:phaser-depth': [
        { nodeName: 'lfoGain', property: 'gain', scale: 1000 },
        { nodeName: 'wet', property: 'gain', scale: 0.5, offset: 0.25 },
        { nodeName: 'dry', property: 'gain', scale: -0.5, offset: 0.75 },
    ],
    'builtin-chorus:chorus-rate': [
        { nodeName: 'lfo1', property: 'frequency' },
        { nodeName: 'lfo2', property: 'frequency', scale: 1.2 },
    ],
    'builtin-chorus:chorus-depth': [
        { nodeName: 'lfoGain1', property: 'gain', scale: 1 / 1000 },
        { nodeName: 'lfoGain2', property: 'gain', scale: 1 / 1000 },
    ],
    'builtin-tremolo:trem-rate': [{ nodeName: 'lfo', property: 'frequency' }],
    'builtin-tremolo:trem-depth': [{ nodeName: 'lfoDepth', property: 'gain' }],
    'builtin-stereo-widener:width-amount': [{ nodeName: 'sideGain', property: 'gain' }],
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

export function resolveDeviceParamTargets(
    deviceType: string,
    parameterId: string,
    node: OfflineDeviceNode
): ResolvedDeviceParamTarget[] {
    const definitions = paramTargetMap[`${deviceType}:${parameterId}`] ?? [];
    const targets: ResolvedDeviceParamTarget[] = [];
    for (const definition of definitions) {
        const targetNode = resolveTargetNode(node, definition);
        const candidate: unknown = targetNode ? Reflect.get(targetNode, definition.property) : null;
        if (isAudioParam(candidate)) {
            targets.push({
                audioParam: candidate,
                scale: definition.scale ?? 1,
                offset: definition.offset ?? 0,
            });
        }
    }
    return targets;
}

export function resolveDeviceParamScale(deviceType: string, parameterId: string): number {
    return paramTargetMap[`${deviceType}:${parameterId}`]?.[0]?.scale ?? 1;
}
