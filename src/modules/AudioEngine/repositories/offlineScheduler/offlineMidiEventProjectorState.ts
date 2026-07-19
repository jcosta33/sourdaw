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

export const offlineMidiEventProjectorState: { project: OfflineMidiEventProjector | null } = {
    project: null,
};
