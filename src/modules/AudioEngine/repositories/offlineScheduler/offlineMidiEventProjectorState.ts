type OfflineMidiProjectableEvent = {
    id: string;
    startBeat: number;
    duration: number;
    velocity: number;
};

type OfflineClipMidiEventProjectionInput<Event extends OfflineMidiProjectableEvent> = {
    events: readonly Event[];
    clipId: string;
    clipStartBeat: number;
    clipEndBeat: number;
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
    loopEnabled?: boolean;
    clipGrooveAlreadyApplied?: boolean;
    eventsAreAbsolute?: boolean;
    phase?: 'clip-groove' | 'complete';
};

type OfflineSequencerMidiEventProjectionInput<Event extends OfflineMidiProjectableEvent> = {
    events: readonly Event[];
    phase: 'sequencer-groove';
};

type OfflineMidiEventProjectionInput<Event extends OfflineMidiProjectableEvent> =
    OfflineClipMidiEventProjectionInput<Event> | OfflineSequencerMidiEventProjectionInput<Event>;

export type OfflineMidiEventProjector = <Event extends OfflineMidiProjectableEvent>(
    input: OfflineMidiEventProjectionInput<Event>
) => readonly Event[];

export type OfflineMidiEventProjectorFactory = () => OfflineMidiEventProjector;

export type OfflineMidiProbabilitySelectionInput = {
    projectProbabilitySeed: number;
    clipId: string;
    eventId: string;
    absoluteOccurrenceIndex: number;
    probabilityPercent: number;
};

export type OfflineMidiProbabilitySelector = (input: OfflineMidiProbabilitySelectionInput) => boolean;

export type OfflineChordPitchProjector = (input: {
    pitch: number;
    referenceBeat: number;
    targetBeat: number;
}) => number;

export type OfflineChordPitchProjectorFactory = () => OfflineChordPitchProjector;

export type OfflineAutomationValueEvaluator = (laneId: string, beat: number) => number | null;

export type OfflineMidiArticulationResolver = (input: {
    deviceType: string;
    articulation: string | undefined;
}) => number | null;

export const offlineMidiEventProjectorState: {
    createProjector: OfflineMidiEventProjectorFactory | null;
    selectProbability: OfflineMidiProbabilitySelector | null;
    createChordPitchProjector: OfflineChordPitchProjectorFactory | null;
    evaluateAutomationValue: OfflineAutomationValueEvaluator | null;
    resolveArticulationId: OfflineMidiArticulationResolver | null;
} = {
    createProjector: null,
    selectProbability: null,
    createChordPitchProjector: null,
    evaluateAutomationValue: null,
    resolveArticulationId: null,
};
