/**
 * Render state model shared by DDSP, Kokoro, and DiffSinger pipelines.
 */

export type PhraseRenderStatus =
    | 'not-rendered'
    | 'queued'
    | 'preparing'
    | 'rendering-browser'
    | 'rendering-native'
    | 'preview'
    | 'final'
    | 'stale'
    | 'error';

export type RenderQuality = 'low' | 'standard' | 'high' | 'maximum';

export const RENDER_QUALITY_STEPS: Record<RenderQuality, number> = {
    low: 3,
    standard: 5,
    high: 10,
    maximum: 20,
} as const;

export type RenderProgressPayload = {
    requestId: string;
    phraseId: string;
    stage: string;
    /** 0–1 */
    progress: number;
    estimatedSecondsRemaining?: number;
};

export type RenderResult = {
    requestId: string;
    phraseId: string;
    /** 44.1 kHz PCM audio */
    audio: Float32Array;
    durationSeconds: number;
    /** Provenance metadata for the provenance chip */
    provenance: RenderProvenance;
};

export type RenderProvenance = {
    modelId: string;
    voiceId?: string;
    steps?: number;
    seed?: number;
    renderQuality: RenderQuality;
    renderedAt: number;
    /** 'browser-preview' or 'native-final' */
    tier: 'browser-preview' | 'native-final';
};

export type ActiveRender = {
    requestId: string;
    phraseId: string;
    pipeline: 'ddsp' | 'kokoro' | 'diffsinger';
    status: PhraseRenderStatus;
    stage: string;
    progress: number;
    startedAt: number;
};
