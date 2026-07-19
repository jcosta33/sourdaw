type OfflineMidiProjectableEvent = {
    id: string;
    startBeat: number;
    velocity: number;
};

type OfflineMidiEventProjectionInput<Event extends OfflineMidiProjectableEvent> = {
    events: readonly Event[];
    consumerType: 'clip';
    consumerId: string;
};

export type OfflineMidiEventProjector = <Event extends OfflineMidiProjectableEvent>(
    input: OfflineMidiEventProjectionInput<Event>
) => readonly Event[];

export const offlineMidiEventProjectorState: { project: OfflineMidiEventProjector | null } = {
    project: null,
};
