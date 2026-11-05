import type { ProjectYeastRack } from '../../../models/ProjectData';

type SavedRackProcessors = ProjectYeastRack['processors'];

/** Where a save reads each MIDI processor rack it writes into the file. */
type RackProcessorReader = {
    /**
     * The live processors of the rack the device owns, in rack order. The
     * module's own array: the save clones it before it enters the file.
     */
    readProcessors: (deviceId: string) => SavedRackProcessors;
};

let registeredReader: RackProcessorReader | null = null;

/**
 * Project may not import a device module, so the composition root
 * (`#/app/registerDeviceEnginePorts`) fills this once at boot, before anything
 * can save a project.
 */
export const rackProcessorReader = {
    /**
     * Registering the identical reader again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(reader: RackProcessorReader): void {
        if (registeredReader === null) {
            registeredReader = reader;
            return;
        }
        if (registeredReader.readProcessors !== reader.readProcessors) {
            throw new Error('rackProcessorReader.configure: the rack reader differs from the registered one');
        }
    },
    /**
     * The registered reader. Reading before registration throws rather than
     * answering empty racks: a save would then silently drop every processor
     * the musician added.
     */
    read(caller: string): RackProcessorReader {
        if (registeredReader === null) {
            throw new Error(
                `${caller}: the rack processor reader is not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredReader;
    },
};
