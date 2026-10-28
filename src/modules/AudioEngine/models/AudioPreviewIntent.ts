export type AudioPreviewIntent = {
    signal: AbortSignal;
    isCurrent: () => boolean;
    release: () => void;
};
