type TempoChange = {
    id: string;
    beat: number;
    tempo: number;
    curve: 'instant' | 'linear';
};

type PpqEndpointProjectionInput = {
    startPpq: number;
    endPpq: number;
    defaultTempo: number;
    sampleRate: number;
    changes: readonly TempoChange[];
};

type PpqEndpointProjection = {
    startSamples: number;
    endSamples: number;
    durationSamples: number;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
};

type MidiProjectableEvent = {
    id: string;
    startBeat: number;
    duration: number;
    velocity: number;
};

type MidiEventProjector = <Event extends MidiProjectableEvent>(input: {
    events: readonly Event[];
    clipId: string;
    clipStartBeat: number;
    clipEndBeat: number;
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
    loopEnabled?: boolean;
}) => readonly Event[];

type OfflineYeastMidiEvent = {
    timeSamples: number;
    trackId?: string;
    sourceEventId?: string;
    noteInstanceId?: string;
    timePpq?: number;
    tempoBpm?: number;
    kind:
        | { type: 'noteOn'; channel: number; note: number; velocity: number }
        | { type: 'noteOff'; channel: number; note: number }
        | { type: 'cc'; channel: number; cc: number; value: number }
        | { type: 'pitchBend'; channel: number; value: number }
        | { type: 'channelPressure'; channel: number; value: number };
};
type OfflineYeastMidiProcessor = (input: {
    trackId: string;
    sampleRate: number;
    blockStartSamples: number;
    blockEndSamples: number;
    events: readonly OfflineYeastMidiEvent[];
}) => readonly OfflineYeastMidiEvent[];

type OfflineRenderDependencies = {
    projectPpqEndpoints: (input: PpqEndpointProjectionInput) => PpqEndpointProjection;
    createMidiEventProjector: () => MidiEventProjector;
    createYeastMidiProcessor: () => OfflineYeastMidiProcessor;
};

export let offlineRenderDependencies: OfflineRenderDependencies | null = null;

export function setOfflineRenderDependencies(dependencies: OfflineRenderDependencies | null): void {
    offlineRenderDependencies = dependencies;
}
