import { type OfflineDeviceNode } from '../devices/types';

import { DeviceFactoryRegistry } from './AudioDeviceStrategy';
import { createFaustStrategy } from './FaustDeviceStrategy';
import { isNativeDspDevice } from './nativeDspDeviceFactories';
import { createNativeDspStrategy } from './NativeDspDeviceStrategy';
import { createWebAudioDevice } from './WebAudioDeviceStrategy';

type CreateDeviceRegistryInput = {
    faustModuleMatcher: (type: string) => boolean;
    /**
     * Whether a matched Faust module is an instrument. Separate from the
     * matcher because both instruments and effects carry the `faust-` prefix,
     * and only an instrument may claim the track's notes.
     */
    faustInstrumentMatcher: (type: string) => boolean;
    createFaustDevice: (input: { ctx: BaseAudioContext; faustModuleId: string }) => Promise<OfflineDeviceNode | null>;
};

export function createDeviceRegistry({
    faustModuleMatcher,
    faustInstrumentMatcher,
    createFaustDevice,
}: CreateDeviceRegistryInput): DeviceFactoryRegistry {
    const registry = new DeviceFactoryRegistry();

    // `builtin-` is a prefix arm and `createDevice` stops at the first match,
    // so a native device whose catalog id carries that prefix — Crumbs — would
    // be routed to a WebAudio factory that has no node for it and refuse. Live
    // playback has never had that problem: `TrackNode.addDevice` tries
    // `createBuiltinDeviceNode` first and *falls through* to the wasm registry
    // when it hands back nothing. Excluding the native ids here reproduces that
    // fall-through in a first-match registry. The sets are disjoint, so no
    // other id changes arm.
    function isBuiltinWebAudioDevice(type: string): boolean {
        return type.startsWith('builtin-') && !isNativeDspDevice(type);
    }

    // eslint-disable-next-line @typescript-eslint/require-await -- registry callback signature is async; createWebAudioDevice is currently synchronous
    registry.register(isBuiltinWebAudioDevice, async (ctx, device) => createWebAudioDevice(ctx, device));

    registry.register(faustModuleMatcher, (ctx, device) =>
        createFaustStrategy({ ctx, device, createFaustDevice, isFaustInstrument: faustInstrumentMatcher })
    );

    // The matcher and the factory read the same table, so a native device can
    // never be buildable yet unclaimed by the registry (MD-4 review: that gap
    // silently dropped GrandBoule out of every device chain).
    registry.register(isNativeDspDevice, createNativeDspStrategy);

    return registry;
}

export type { AudioDeviceStrategy, DeviceCreator, DeviceFactoryRegistry } from './AudioDeviceStrategy';
