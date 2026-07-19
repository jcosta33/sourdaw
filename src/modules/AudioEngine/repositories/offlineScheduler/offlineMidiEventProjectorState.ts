type OfflineMidiProjectableEvent = {
    id: string;
    startBeat: number;
    duration: number;
    velocity: number;
};

type OfflineMidiEventProjectionInput<Event extends OfflineMidiProjectableEvent> = {
    events: readonly Event[];
    clipId: string;
    clipStartBeat: number;
    clipEndBeat: number;
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
};

export type OfflineMidiEventProjector = <Event extends OfflineMidiProjectableEvent>(
    input: OfflineMidiEventProjectionInput<Event>
) => readonly Event[];

export type OfflineMidiEventProjectorFactory = () => OfflineMidiEventProjector;

export const offlineMidiEventProjectorState: { createProjector: OfflineMidiEventProjectorFactory | null } = {
    createProjector: null,
};
