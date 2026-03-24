import { type OfflineDeviceNode } from '#/modules/AudioEngine/useCases/buildDeviceChain';
import { getDrumKitByIndex, type DrumKit } from '#/modules/Synth/useCases/drumKitSynth';

export function resolveDrumKit(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null {
    const kitDevice = devices.find((d) => d.type === 'builtin-drum-kit' || d.type.startsWith('builtin-drum-machine'));
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kit ?? kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitByIndex(kitIndex);
}

export const resolveDeviceParam = (
    deviceType: string,
    parameterId: string,
    node: OfflineDeviceNode
): AudioParam | null => {
    const paramMap: Record<string, () => AudioParam | null> = {
        'builtin-eq:eq-low-gain': () => (node.nodes[0] as BiquadFilterNode | undefined)?.gain ?? null,
        'builtin-eq:eq-low-freq': () => (node.nodes[0] as BiquadFilterNode | undefined)?.frequency ?? null,
        'builtin-eq:eq-mid-gain': () => (node.nodes[1] as BiquadFilterNode | undefined)?.gain ?? null,
        'builtin-eq:eq-mid-freq': () => (node.nodes[1] as BiquadFilterNode | undefined)?.frequency ?? null,
        'builtin-eq:eq-mid-q': () => (node.nodes[1] as BiquadFilterNode | undefined)?.Q ?? null,
        'builtin-eq:eq-high-gain': () => (node.nodes[2] as BiquadFilterNode | undefined)?.gain ?? null,
        'builtin-eq:eq-high-freq': () => (node.nodes[2] as BiquadFilterNode | undefined)?.frequency ?? null,
        'builtin-compressor:comp-threshold': () =>
            (node.nodes[0] as DynamicsCompressorNode | undefined)?.threshold ?? null,
        'builtin-compressor:comp-ratio': () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.ratio ?? null,
        'builtin-compressor:comp-attack': () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.attack ?? null,
        'builtin-compressor:comp-release': () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.release ?? null,
        'builtin-compressor:comp-makeup': () => (node.nodes[1] as GainNode | undefined)?.gain ?? null,
        'builtin-reverb:rev-mix': () => (node.nodes[2] as GainNode | undefined)?.gain ?? null,
        'builtin-delay:delay-time': () => (node.nodes[3] as DelayNode | undefined)?.delayTime ?? null,
        'builtin-delay:delay-feedback': () => (node.nodes[4] as GainNode | undefined)?.gain ?? null,
        'builtin-delay:delay-mix': () => (node.nodes[2] as GainNode | undefined)?.gain ?? null,
        'builtin-gain:gain-level': () => (node.nodes[0] as GainNode | undefined)?.gain ?? null,
        'builtin-limiter:lim-threshold': () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.threshold ?? null,
        'builtin-limiter:lim-release': () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.release ?? null,
        'builtin-limiter:lim-ceiling': () => (node.nodes[1] as GainNode | undefined)?.gain ?? null,
    };

    const resolver = paramMap[`${deviceType}:${parameterId}`];
    if (resolver) {
        return resolver();
    }
    return null;
};
