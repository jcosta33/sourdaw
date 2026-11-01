export type AudioPreviewIntent = {
    signal: AbortSignal;
    isCurrent: () => boolean;
    release: () => void;
    /** Present only when this ordinary gesture must await a prior output restoration. */
    ready?: Promise<void>;
};
