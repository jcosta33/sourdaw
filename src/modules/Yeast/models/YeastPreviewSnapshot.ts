export const YEAST_PREVIEW_CAPACITY = 512;
export const YEAST_PREVIEW_REALIZED_FLAG = 1;
export const YEAST_PREVIEW_BYPASSED_FLAG = 2;
export const YEAST_PREVIEW_FAILED_FLAG = 4;
export const YEAST_PREVIEW_VALID_FLAGS =
    YEAST_PREVIEW_REALIZED_FLAG | YEAST_PREVIEW_BYPASSED_FLAG | YEAST_PREVIEW_FAILED_FLAG;

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

/** Fixed-capacity Worker transport page. Only the first `count` slots are live. */
export type YeastPreviewPackedPage = {
    count: number;
    droppedEvents: number;
    readonly beatTime: Float64Array;
    readonly durationBeats: Float64Array;
    readonly pitch: Uint8Array;
    readonly velocity: Float64Array;
    /** NaN encodes a null probability. */
    readonly probability: Float64Array;
    readonly flags: Uint8Array;
    readonly processorId: string[];
};

export type YeastPreviewSnapshot = Readonly<{
    capacity: number;
    events: readonly YeastPreviewEvent[];
    droppedEvents: number;
}>;
