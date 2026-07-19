export const YEAST_PREVIEW_CAPACITY = 512;

export type YeastPreviewEvent = Readonly<{
    beatTime: number;
    durationBeats: number;
    pitch: number;
    velocity: number;
    probability: number | null;
    realized: boolean;
    processorId: string;
    bypassed: boolean;
    failed: boolean;
}>;

export type YeastPreviewBlock = Readonly<{
    records: readonly YeastPreviewEvent[];
    droppedEvents: number;
}>;

export type YeastPreviewSnapshot = Readonly<{
    capacity: number;
    events: readonly YeastPreviewEvent[];
    droppedEvents: number;
}>;
