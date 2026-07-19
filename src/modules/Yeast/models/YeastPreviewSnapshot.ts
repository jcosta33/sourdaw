export const YEAST_PREVIEW_CAPACITY = 512;
export const YEAST_PREVIEW_OPEN_PHASE = 0;
export const YEAST_PREVIEW_CLOSED_PHASE = 1;
export const YEAST_PREVIEW_REALIZED_FLAG = 1;
export const YEAST_PREVIEW_BYPASSED_FLAG = 2;
export const YEAST_PREVIEW_FAILED_FLAG = 4;
export const YEAST_PREVIEW_VALID_FLAGS =
    YEAST_PREVIEW_REALIZED_FLAG | YEAST_PREVIEW_BYPASSED_FLAG | YEAST_PREVIEW_FAILED_FLAG;

export type YeastPreviewEvent = Readonly<{
    eventId: number;
    rackId: string;
    routeId: string;
    trackId: string;
    projectionVersion: number;
    phase: 'open' | 'closed';
    beatTime: number;
    durationBeats: number;
    pitch: number;
    velocity: number;
    probability: number | null;
    realized: boolean;
    processorId: string | null;
    bypassed: boolean;
    failed: boolean;
}>;

export type YeastPreviewProcessorProvenance = Readonly<{
    processorId: string;
    bypassed: boolean;
    failed: boolean;
    eventCount: number;
}>;

export type YeastPreviewBlock = Readonly<{
    rackId: string;
    routeId: string;
    trackId: string;
    captureEpoch: number;
    projectionVersion: number;
    reset: boolean;
    records: readonly YeastPreviewEvent[];
    provenance: readonly YeastPreviewProcessorProvenance[];
    droppedEvents: number;
}>;

/** Fixed-capacity Worker transport page. Only the first `count` slots are live. */
export type YeastPreviewPackedPage = {
    rackId: string;
    routeId: string;
    trackId: string;
    projectionVersion: number;
    reset: boolean;
    count: number;
    provenanceCount: number;
    droppedEvents: number;
    readonly eventId: Float64Array;
    readonly phase: Uint8Array;
    readonly beatTime: Float64Array;
    readonly durationBeats: Float64Array;
    readonly pitch: Uint8Array;
    readonly velocity: Float64Array;
    /** NaN encodes a null probability. */
    readonly probability: Float64Array;
    readonly flags: Uint8Array;
    readonly rackIds: string[];
    readonly routeIds: string[];
    readonly trackIds: string[];
    readonly processorId: string[];
    readonly provenanceEventCount: Uint16Array;
    readonly provenanceFlags: Uint8Array;
    readonly provenanceProcessorId: string[];
};

export type YeastPreviewSnapshot = Readonly<{
    rackId: string;
    routeId: string;
    trackId: string;
    projectionVersion: number;
    reset: boolean;
    capacity: number;
    events: readonly YeastPreviewEvent[];
    provenance: readonly YeastPreviewProcessorProvenance[];
    droppedEvents: number;
}>;
