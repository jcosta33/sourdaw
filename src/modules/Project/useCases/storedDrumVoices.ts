type DrumVoiceFamily = 'kick' | 'snare' | 'hi-hat' | 'tom' | 'cymbal' | 'percussion';

type StoredDrumVoices =
    { status: 'unknown' } | { status: 'known'; voices: Array<{ pitch: number; family: DrumVoiceFamily | null }> };

/** Where track-role inference reads the voices a sampled drum kit stores. */
type StoredDrumVoicesReader = {
    /**
     * The kit's voices as its stored device state records them, or `unknown`
     * when the state carries no readable voice record.
     */
    voicesOf: (deviceState: unknown) => StoredDrumVoices;
};

let registeredReader: StoredDrumVoicesReader | null = null;

/**
 * Project may not import a device module, so the composition root
 * (`#/app/registerDeviceEnginePorts`) fills this once at boot, before anything
 * can infer a track's role.
 */
export const storedDrumVoices = {
    /**
     * Registering the identical reader again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(reader: StoredDrumVoicesReader): void {
        if (registeredReader === null) {
            registeredReader = reader;
            return;
        }
        if (registeredReader.voicesOf !== reader.voicesOf) {
            throw new Error('storedDrumVoices.configure: the voice reader differs from the registered one');
        }
    },
    /**
     * The registered reader. Reading before registration throws rather than
     * answering `unknown`: every sampled kit would then lose the voice roles
     * its own pads declare.
     */
    read(caller: string): StoredDrumVoicesReader {
        if (registeredReader === null) {
            throw new Error(
                `${caller}: the stored drum voice reader is not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredReader;
    },
};
