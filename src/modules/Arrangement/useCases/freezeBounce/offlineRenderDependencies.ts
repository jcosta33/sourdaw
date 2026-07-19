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
}) => readonly Event[];

type OfflineRenderDependencies = {
    projectPpqEndpoints: (input: PpqEndpointProjectionInput) => PpqEndpointProjection;
    createMidiEventProjector: () => MidiEventProjector;
};

export let offlineRenderDependencies: OfflineRenderDependencies | null = null;

export function setOfflineRenderDependencies(dependencies: OfflineRenderDependencies | null): void {
    offlineRenderDependencies = dependencies;
}
