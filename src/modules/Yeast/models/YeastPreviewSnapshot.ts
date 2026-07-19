export type YeastPreviewEvent = Readonly<{
    beatTime: number;
    durationBeats: number;
    pitch: number;
    velocity: number;
    probability: number | null;
    realized: boolean;
    processorId: string;
    bypassed: boolean;
}>;

export type YeastPreviewSnapshot = Readonly<{
    capacity: number;
    events: readonly YeastPreviewEvent[];
    droppedEvents: number;
}>;
