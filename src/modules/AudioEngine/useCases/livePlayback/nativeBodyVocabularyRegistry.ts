/**
 * The vocabulary of one built-in body whose translation its device module owns:
 * how the ids a panel or an automation lane authors become the engine's names.
 */
type NativeBodyVocabulary = {
    /** The engine's name for one of this body's parameters, from the id a panel or lane authors. */
    parameterName: (paramId: string) => string;
    /** The engine's flat record for this body's patch, from the device's stored values. */
    projectPatch: (values: Readonly<Record<string, unknown>>) => Readonly<Record<string, number>>;
    /** Whether this body resolves a project-side parameter id at all. */
    addressesParameter: (paramId: string) => boolean;
};

type NativeBodyVocabularies = Readonly<Record<string, NativeBodyVocabulary>>;

let registeredVocabularies: ReadonlyMap<string, NativeBodyVocabulary> | null = null;

function findChangedDeviceType(
    current: ReadonlyMap<string, NativeBodyVocabulary>,
    next: ReadonlyMap<string, NativeBodyVocabulary>
): string | null {
    for (const deviceType of new Set([...current.keys(), ...next.keys()])) {
        if (current.get(deviceType) !== next.get(deviceType)) {
            return deviceType;
        }
    }
    return null;
}

/**
 * Body vocabularies keyed by device type. A device module's parameter tables
 * belong to that module, and AudioEngine may not import a device module, so the
 * composition root (`#/app/registerDeviceEnginePorts`) fills this once at boot,
 * before anything can build a native body.
 */
export const nativeBodyVocabularyRegistry = {
    /**
     * Registering the identical vocabularies again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * set refuses.
     */
    configure(vocabularies: NativeBodyVocabularies): void {
        const next = new Map(Object.entries(vocabularies));
        if (registeredVocabularies === null) {
            registeredVocabularies = next;
            return;
        }
        const changedDeviceType = findChangedDeviceType(registeredVocabularies, next);
        if (changedDeviceType !== null) {
            throw new Error(
                `nativeBodyVocabularyRegistry.configure: the vocabulary for '${changedDeviceType}' differs from the registered one`
            );
        }
    },
    /**
     * The vocabulary registered for `deviceType`, or `null` when no device
     * module registered one. Reading before registration throws rather than
     * answering `null` for every type: an empty registry would silently send a
     * body its parameters under the wrong names.
     */
    read(caller: string, deviceType: string): NativeBodyVocabulary | null {
        if (registeredVocabularies === null) {
            throw new Error(
                `${caller}: native body vocabularies are not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredVocabularies.get(deviceType) ?? null;
    },
};
