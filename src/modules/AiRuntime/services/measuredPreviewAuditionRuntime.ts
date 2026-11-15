export type MeasuredPreviewAuditionOperation = {
    id: string;
    confirmationId: string;
    /** The surface whose comparison started it; only that surface leaving stops it on its behalf. */
    surface: 'chat' | 'agent-workspace';
    targetId: string;
    side: 'baseline' | 'preview';
    identity: string;
    abort: AbortController;
    stopPlayback: (() => Promise<void>) | null;
    releaseObservers: () => void;
    restoration: Promise<void> | null;
};

/** Private handles only. Retiring operations cannot overwrite their successor's projection. */
export const measuredPreviewAuditionRuntime: {
    current: MeasuredPreviewAuditionOperation | null;
    operations: Map<string, MeasuredPreviewAuditionOperation>;
} = { current: null, operations: new Map() };
