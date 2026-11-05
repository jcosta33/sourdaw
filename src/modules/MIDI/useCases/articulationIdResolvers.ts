/**
 * The engine's id for a project articulation name, or `null` for a name the
 * instrument does not voice. The ids are a wire contract between the
 * instrument's module and its DSP engine, so the module owns the table.
 */
type ArticulationIdResolver = (articulation: string) => number | null;

type ArticulationIdResolvers = Readonly<Record<string, ArticulationIdResolver>>;

let registeredResolvers: ReadonlyMap<string, ArticulationIdResolver> | null = null;

function findChangedDeviceType(
    current: ReadonlyMap<string, ArticulationIdResolver>,
    next: ReadonlyMap<string, ArticulationIdResolver>
): string | null {
    for (const deviceType of new Set([...current.keys(), ...next.keys()])) {
        if (current.get(deviceType) !== next.get(deviceType)) {
            return deviceType;
        }
    }
    return null;
}

/**
 * Articulation id resolvers keyed by device type. MIDI may not import a device
 * module, so the composition root (`#/app/registerDeviceEnginePorts`) fills
 * this once at boot, before anything can play a note.
 */
export const articulationIdResolvers = {
    /**
     * Registering the identical resolvers again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * set refuses.
     */
    configure(resolvers: ArticulationIdResolvers): void {
        const next = new Map(Object.entries(resolvers));
        if (registeredResolvers === null) {
            registeredResolvers = next;
            return;
        }
        const changedDeviceType = findChangedDeviceType(registeredResolvers, next);
        if (changedDeviceType !== null) {
            throw new Error(
                `articulationIdResolvers.configure: the resolver for '${changedDeviceType}' differs from the registered one`
            );
        }
    },
    /**
     * The resolver registered for `deviceType`, or `null` when the instrument
     * has no per-note articulation surface. Reading before registration throws
     * rather than answering `null` for every type: an empty registry would
     * silently voice every articulated note with the default articulation.
     */
    read(caller: string, deviceType: string): ArticulationIdResolver | null {
        if (registeredResolvers === null) {
            throw new Error(
                `${caller}: articulation id resolvers are not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredResolvers.get(deviceType) ?? null;
    },
};
