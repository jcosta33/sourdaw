/** What the live input reads of MIDI learn: whether a control is armed, and which controllers are mapped. */
type MidiLearnReading = {
    isLearning: boolean;
    learningTarget: unknown;
    mappings: readonly { channel: number; cc: number }[];
} | null;

/**
 * The MIDI learn routing a controller message passes through before it acts
 * as an ordinary controller: an armed learn takes it as a mapping, and a
 * learned mapping turns it into a parameter move.
 */
type MidiLearnRouting = {
    getMidiLearnState: () => MidiLearnReading;
    completeMidiLearn: (channel: number, cc: number) => void;
    applyMidiMappings: (channel: number, cc: number, value: number, normalized?: number) => void;
};

let registeredRouting: MidiLearnRouting | null = null;

/**
 * MIDI may not import ControlSurface, which maps hardware onto it, so the
 * composition root (`#/app/registerSupportingServicePorts`) fills this once at
 * boot, before any MIDI input can arrive.
 */
export const midiLearnRouting = {
    /**
     * Registering the identical routing again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(routing: MidiLearnRouting): void {
        if (registeredRouting === null) {
            registeredRouting = routing;
            return;
        }
        if (
            registeredRouting.getMidiLearnState !== routing.getMidiLearnState ||
            registeredRouting.completeMidiLearn !== routing.completeMidiLearn ||
            registeredRouting.applyMidiMappings !== routing.applyMidiMappings
        ) {
            throw new Error('midiLearnRouting.configure: the routing differs from the registered one');
        }
    },
    /**
     * The registered routing. Reading before registration throws rather than
     * answering no learn state: an armed learn would then miss the controller
     * the musician moved, and a mapped controller would be recorded into a
     * take instead of moving its parameter.
     */
    read(caller: string): MidiLearnRouting {
        if (registeredRouting === null) {
            throw new Error(
                `${caller}: MIDI learn routing is not registered; call registerSupportingServicePorts() from #/app/registerSupportingServicePorts (bootstrap does this)`
            );
        }
        return registeredRouting;
    },
};
