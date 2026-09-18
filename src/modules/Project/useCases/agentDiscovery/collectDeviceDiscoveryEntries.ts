import { getAgentBuiltinDeviceFactoryManifest } from '#/modules/Arrangement/useCases';
import { getAgentBuiltinDeviceRuntimeManifest } from '#/modules/AudioEngine/useCases';
import { defaultPluginScanState, pluginScanStore } from '#/modules/PluginHost/stores';
import { getAgentDeviceFactoryManifest } from '#/modules/PluginHost/useCases';

import { type DiscoveryCandidate } from '../../services/agentDiscovery/discoveryCandidates';

/** The runtime version the device manifest names when no factory claims a type. */
const RUNTIME_UNAVAILABLE_VERSION = 'runtime-v1:unavailable';

export type DeviceDiscoveryCollection = {
    candidates: DiscoveryCandidate[];
    warnings: string[];
    /** True once a scan has run, whatever it found. */
    pluginScanRan: boolean;
};

type BuiltinDescriptor = ReturnType<typeof getAgentBuiltinDeviceFactoryManifest>[number];
type BuiltinRuntime = ReturnType<typeof getAgentBuiltinDeviceRuntimeManifest>[number];
type ExternalDevice = ReturnType<typeof getAgentDeviceFactoryManifest>['devices'][number];

function toBuiltinCandidate(descriptor: BuiltinDescriptor, runtime: BuiltinRuntime | undefined): DiscoveryCandidate {
    const runtimeVersion = runtime?.runtimeVersion ?? RUNTIME_UNAVAILABLE_VERSION;
    const unavailableReason = (() => {
        if (descriptor.availability === 'unavailable-on-platform') {
            return 'unavailable-on-platform';
        }
        return runtime === undefined ? 'runtime-unavailable' : null;
    })();
    return {
        kind: 'builtin',
        entry: {
            id: descriptor.type,
            name: descriptor.name,
            domain: 'device',
            availability: unavailableReason === null ? 'available' : 'unavailable',
            reason: unavailableReason,
            version: `builtin-factory-v2:${descriptor.descriptorVersion}:${descriptor.presetVersion}:${runtimeVersion}`,
            evidence: {
                source: 'builtin-device-manifest',
                vendor: descriptor.vendor,
                category: descriptor.category,
                platform: descriptor.platform,
                descriptorAvailability: descriptor.availability,
                descriptorVersion: descriptor.descriptorVersion,
                presetVersion: descriptor.presetVersion,
                runtimeVersion,
                presets: descriptor.presets,
            },
        },
    };
}

function toExternalCandidate(device: ExternalDevice): DiscoveryCandidate {
    return {
        kind: 'external',
        entry: {
            id: device.type,
            name: device.name,
            domain: 'device',
            availability: 'available',
            reason: null,
            version: device.version,
            evidence: {
                source: 'plugin-scan',
                vendor: device.vendor,
                category: device.category,
                versions: device.versions,
                configuration: device.configuration,
                parameterDescriptors: device.parameterDescriptors,
                ports: device.ports,
                latency: device.latency,
                presets: device.presets,
                metadata: device.metadata,
            },
        },
    };
}

/**
 * Built-in device descriptors joined to the runtime facts of the factory that
 * builds them, plus the external factories the last scan published.
 *
 * The two producers answer independently: a platform the descriptor refuses and
 * a type no factory claims are different `unavailable` reasons, and a scan that
 * has never run withholds the external half without withholding the built-in
 * one. Nothing here mints a device type or a version of its own.
 */
export function collectDeviceDiscoveryEntries(): DeviceDiscoveryCollection {
    const descriptors = getAgentBuiltinDeviceFactoryManifest();
    const runtimeByType = new Map(
        getAgentBuiltinDeviceRuntimeManifest(descriptors.map((descriptor) => descriptor.type)).map((runtime) => [
            runtime.type,
            runtime,
        ])
    );
    const builtins = descriptors.map((descriptor) =>
        toBuiltinCandidate(descriptor, runtimeByType.get(descriptor.type))
    );

    const pluginScanRan = (pluginScanStore.value ?? defaultPluginScanState).lastScanTime !== null;
    if (!pluginScanRan) {
        return { candidates: builtins, warnings: ['plugin-scan-not-run'], pluginScanRan };
    }
    return {
        candidates: [...builtins, ...getAgentDeviceFactoryManifest().devices.map(toExternalCandidate)],
        warnings: [],
        pluginScanRan,
    };
}
