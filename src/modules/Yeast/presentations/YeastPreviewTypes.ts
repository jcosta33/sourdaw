import type { YeastPreviewEvent } from '../models/YeastPreviewSnapshot';

export type YeastPreviewScope = Readonly<{
    rackId: string;
    routeId: string;
    trackId: string;
}>;

export type YeastPreviewUnavailableReason = Readonly<{
    code: 'no-track' | 'no-yeast-device' | 'runtime-unavailable';
    message: string;
}>;

export type DenseRenderer<Model> = {
    readonly backend: 'canvas2d' | 'webgpu';
    render(model: Model): void;
    resize(width: number, height: number): void;
    dispose(): void;
};

export type YeastPreviewRenderModel = Readonly<{
    events: readonly YeastPreviewEvent[];
    playheadBeat: number;
    lookaheadBeats: number;
    width: number;
    height: number;
}>;

export type YeastPreviewProcessorActivity = Readonly<{
    processorId: string;
    eventCount: number;
    status: 'active' | 'enabled' | 'bypassed' | 'failed';
}>;

export type YeastPreviewFeedback = Readonly<{
    hasSample: boolean;
    active: boolean;
    latencyP95Ms: number | null;
    visibleEvents: number;
    droppedEvents: number;
    droppedFrames: number;
    droppedVisualEvents: number;
    processorActivity: readonly YeastPreviewProcessorActivity[];
    summary: string;
    /**
     * Pitches of realized preview events whose scheduled window currently
     * contains the playhead — the rack's own note-activity stream, reused by
     * KeyboardSplit so it renders real output instead of a static keyboard.
     */
    soundingPitches: readonly number[];
}>;
