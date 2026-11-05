/** One sample-timed MIDI event as the live MIDI processor reads and answers it. */
export type LiveMidiProcessorEvent = {
    /** Absolute sample time on the global timeline. */
    timeSamples: number;
    kind:
        | { type: 'noteOn'; channel: number; note: number; velocity: number }
        | { type: 'noteOff'; channel: number; note: number }
        | { type: 'cc'; channel: number; cc: number; value: number }
        | { type: 'pitchBend'; channel: number; value: number }
        | { type: 'channelPressure'; channel: number; value: number };
    durationSamples?: number;
    durationPpq?: number;
    trackId?: string;
    sourceEventId?: string;
    noteInstanceId?: string;
    timePpq?: number;
    tempoBpm?: number;
};

/** One block of a track's notes, with the transport the processor plays them against. */
type LiveMidiProcessorBlock = {
    context: BaseAudioContext;
    rackId: string;
    routeId: string;
    trackId: string;
    events: readonly LiveMidiProcessorEvent[];
    blockStartSamples: number;
    blockEndSamples: number;
    transport: {
        sampleRate: number;
        bpm: number;
        ppqPosition: number;
        isPlaying: boolean;
        barIndex: number;
        beatInBar: number;
        timeSigNum: number;
        timeSigDen: number;
        loopEnabled: boolean;
        loopStartPpq: number;
        loopEndPpq: number;
        discontinuityEpoch?: number;
        tempoMap: {
            defaultTempo: number;
            changes: readonly { beat: number; tempo: number; curve: 'instant' | 'linear' }[];
        };
    };
    preserveInputTrackIds: boolean;
};

/**
 * The MIDI effect rack a live track's notes pass through before they reach
 * the instrument. Its module owns the rack and its runtime; Transport owns
 * when each block is processed.
 */
type LiveMidiProcessor = {
    /** The block's events after the rack named by `rackId` processed them. */
    processBlock: (block: LiveMidiProcessorBlock) => Promise<LiveMidiProcessorEvent[]>;
    /**
     * The processors the rack named by `rackId` holds, which a prepared
     * programme clones at capture and compares by value afterwards.
     */
    readRackProcessors: (rackId: string) => unknown;
};

let registeredProcessor: LiveMidiProcessor | null = null;

/**
 * Transport may not import a device module, so the composition root
 * (`#/app/registerDeviceEnginePorts`) fills this once at boot, before anything
 * can start playback.
 */
export const liveMidiProcessor = {
    /**
     * Registering the identical processor again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(processor: LiveMidiProcessor): void {
        if (registeredProcessor === null) {
            registeredProcessor = processor;
            return;
        }
        if (
            registeredProcessor.processBlock !== processor.processBlock ||
            registeredProcessor.readRackProcessors !== processor.readRackProcessors
        ) {
            throw new Error('liveMidiProcessor.configure: the processor differs from the registered one');
        }
    },
    /**
     * The registered processor. Reading before registration throws: a missing
     * processor would play a track's notes as if its rack were empty.
     */
    read(caller: string): LiveMidiProcessor {
        if (registeredProcessor === null) {
            throw new Error(
                `${caller}: the live MIDI processor is not registered; call registerDeviceEnginePorts() from #/app/registerDeviceEnginePorts (bootstrap does this)`
            );
        }
        return registeredProcessor;
    },
};
