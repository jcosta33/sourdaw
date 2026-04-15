export type RenderProgressPayload = {
    requestId: string;
    phraseId: string;
    stage: string;
    /** 0–1 */
    progress: number;
};
