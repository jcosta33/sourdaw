export type MeasuredPreviewAuditionOperation = {
    id: string;
    confirmationId: string;
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
