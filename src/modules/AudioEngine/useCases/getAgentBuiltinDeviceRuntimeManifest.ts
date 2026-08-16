import { findWasmDescriptor } from '../engine/wasmDeviceRegistry';
import {
    getBuiltinDeviceRuntimeVersion,
    type AgentBuiltinDeviceRuntime,
    type DeviceRuntimeLiveFacts,
    type DeviceRuntimeOfflineFacts,
} from '../models/BuiltinDeviceRuntime';
import { BUILTIN_DEVICE_NODE_FACTORIES } from '../repositories/deviceNodeFactory';
import { FAUST_OFFLINE_RUNTIME } from '../repositories/deviceStrategy/FaustDeviceStrategy';
import { NATIVE_DSP_DEVICE_FACTORIES } from '../repositories/deviceStrategy/nativeDspDeviceFactories';

function runtimeComponent(deviceType: string): AgentBuiltinDeviceRuntime | null {
    const webAudioFactory = BUILTIN_DEVICE_NODE_FACTORIES.find((factory) => factory.type === deviceType);
    const wasmDescriptor = webAudioFactory ? undefined : findWasmDescriptor(deviceType);
    const nativeDspFactory = webAudioFactory
        ? undefined
        : NATIVE_DSP_DEVICE_FACTORIES.find((factory) => factory.matches(deviceType));
    const live: DeviceRuntimeLiveFacts | undefined = webAudioFactory?.runtime.live ?? wasmDescriptor?.runtime;
    const offline: DeviceRuntimeOfflineFacts | undefined =
        webAudioFactory?.runtime.offline ??
        nativeDspFactory?.runtime ??
        (wasmDescriptor?.runtime.latency.kind === 'runtime-dependent' ? FAUST_OFFLINE_RUNTIME : undefined);

    if (!live || !offline) {
        return null;
    }

    const component = { type: deviceType, live, offline };
    return {
        ...component,
        runtimeVersion: getBuiltinDeviceRuntimeVersion(component),
    };
}

/**
 * Runtime facts come from the factory strategy that constructs the graph, never
 * from Arrangement's descriptor catalog. A caller may request exact catalog
 * types; the unfiltered form is used by the registry weld test.
 */
export function getAgentBuiltinDeviceRuntimeManifest(
    deviceTypes?: readonly string[]
): readonly AgentBuiltinDeviceRuntime[] {
    const requestedTypes =
        deviceTypes ??
        [...BUILTIN_DEVICE_NODE_FACTORIES, ...NATIVE_DSP_DEVICE_FACTORIES].map((factory) => factory.type);
    const seen = new Set<string>();
    const runtime: AgentBuiltinDeviceRuntime[] = [];

    for (const deviceType of requestedTypes) {
        if (seen.has(deviceType)) {
            continue;
        }
        seen.add(deviceType);
        const component = runtimeComponent(deviceType);
        if (component) {
            runtime.push(component);
        }
    }

    return runtime;
}
