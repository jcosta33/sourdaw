import { type ProjectMidiLearnState } from '../../../models/ProjectData';

/** Where a save reads the MIDI learn mappings it writes into the file. */
type MidiLearnProjection = {
    /**
     * The live MIDI learn state, of which the save keeps only its durable
     * half (the schema version and the mappings), or `null` when there is
     * none. The module's own object: the save clones the mappings before they
     * enter the file.
     */
    readMidiLearn: () => ProjectMidiLearnState | null;
};

let registeredProjection: MidiLearnProjection | null = null;

/**
 * Project may not import ControlSurface, which owns MIDI learn, so the
 * composition root (`#/app/registerSupportingServicePorts`) fills this once at
 * boot, before anything can save a project.
 */
export const midiLearnProjection = {
    /**
     * Registering the identical projection again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(projection: MidiLearnProjection): void {
        if (registeredProjection === null) {
            registeredProjection = projection;
            return;
        }
        if (registeredProjection.readMidiLearn !== projection.readMidiLearn) {
            throw new Error('midiLearnProjection.configure: the projection differs from the registered one');
        }
    },
    /**
     * The registered projection. Reading before registration throws rather
     * than answering no mappings: a save would then silently drop every
     * controller the musician learned.
     */
    read(caller: string): MidiLearnProjection {
        if (registeredProjection === null) {
            throw new Error(
                `${caller}: the MIDI learn projection is not registered; call registerSupportingServicePorts() from #/app/registerSupportingServicePorts (bootstrap does this)`
            );
        }
        return registeredProjection;
    },
};
