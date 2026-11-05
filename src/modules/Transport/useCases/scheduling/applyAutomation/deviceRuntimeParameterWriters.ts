/**
 * How automation reaches a device whose module owns its runtime write, instead
 * of the generic engine write every other device takes.
 */
type DeviceRuntimeParameterWriter = {
    /**
     * Deliver one automated value to the device's runtime. The stored manual
     * value and the undo history stay as they are, so the knob returns to it
     * when automation lets go.
     */
    write: (input: { deviceId: string; paramId: string; value: number }) => void;
    /** The engine's name for `paramId`, under which the Web Audio fallback carrier is held. */
    engineParameterName: (paramId: string) => string;
};

type DeviceRuntimeParameterWriters = Readonly<Record<string, DeviceRuntimeParameterWriter>>;

let registeredWriters: ReadonlyMap<string, DeviceRuntimeParameterWriter> | null = null;

function findChangedDeviceType(
    current: ReadonlyMap<string, DeviceRuntimeParameterWriter>,
    next: ReadonlyMap<string, DeviceRuntimeParameterWriter>
): string | null {
    for (const deviceType of new Set([...current.keys(), ...next.keys()])) {
        if (current.get(deviceType) !== next.get(deviceType)) {
            return deviceType;
        }
    }
    return null;
}

/**
 * Runtime parameter writers keyed by device type. Transport may not import a
 * device module, so the composition root (`#/app/registerDeviceEnginePorts`)
 * fills this once at boot, before anything can start playback.
 */
export const deviceRuntimeParameterWriters = {
    /**
     * Registering the identical writers again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * set refuses.
     */
    configure(writers: DeviceRuntimeParameterWriters): void {
        const next = new Map(Object.entries(writers));
        if (registeredWriters === null) {
            registeredWriters = next;
            return;
        }
        const changedDeviceType = findChangedDeviceType(registeredWriters, next);
        if (changedDeviceType !== null) {
            throw new Error(
                `deviceRuntimeParameterWriters.configure: the writer for '${changedDeviceType}' differs from the registered one`
            );
        }
    },
    /**
     * The writer registered for `deviceType`, or `null` when the device takes
     * the generic engine write. Reading before registration throws rather than
     * answering `null` for every type: an empty registry would silently send a
     * device's automation down a door that does not speak its names.
     */
    read(caller: string, deviceType: string): DeviceRuntimeParameterWriter | null {
        if (registeredWriters === null) {
            throw new Error(
                `${caller}: device runtime parameter writers are not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredWriters.get(deviceType) ?? null;
    },
};
