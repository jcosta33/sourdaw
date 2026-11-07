import { type SoundPreset } from '../models/SoundPreset';

/** The factory presets one device module ships for the shared preset library. */
type DeviceFactoryPresetSource = {
    module: string;
    presets: () => readonly SoundPreset[];
};

let registeredSources: readonly DeviceFactoryPresetSource[] | null = null;

function findFirstChangedSource(
    current: readonly DeviceFactoryPresetSource[],
    next: readonly DeviceFactoryPresetSource[]
): string | null {
    const length = Math.max(current.length, next.length);
    for (let index = 0; index < length; index += 1) {
        if (current[index] !== next[index]) {
            return (next[index] ?? current[index])?.module ?? null;
        }
    }
    return null;
}

/**
 * The device modules whose factory presets join the library, in library order.
 * Arrangement may not import a device module, so the composition root
 * (`#/app/registerDeviceEnginePorts`) fills this once at boot, before anything
 * can list presets.
 */
export const deviceFactoryPresetSources = {
    /**
     * Registering the identical list again is a no-op, so a caller that cannot
     * know whether registration already ran may repeat it. A different list
     * refuses.
     */
    configure(sources: readonly DeviceFactoryPresetSource[]): void {
        if (registeredSources === null) {
            registeredSources = [...sources];
            return;
        }
        const changedSource = findFirstChangedSource(registeredSources, sources);
        if (changedSource !== null) {
            throw new Error(
                `deviceFactoryPresetSources.configure: source '${changedSource}' differs from the registered list`
            );
        }
    },
    /**
     * The registered sources, in library order. Reading before registration
     * throws rather than answering an empty list: an empty registry would
     * silently drop every device module's presets from the browser.
     */
    read(caller: string): readonly DeviceFactoryPresetSource[] {
        if (registeredSources === null) {
            throw new Error(
                `${caller}: device factory preset sources are not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredSources;
    },
};
