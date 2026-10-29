import { createStore } from '#/infra/store/createStore';

type AuditionState = {
    confirmationId: string | null;
    operationId: string | null;
    targetId: string | null;
    side: 'baseline' | 'preview' | null;
    phase: 'idle' | 'acquiring' | 'playing' | 'releasing' | 'restore-failed';
    error: string | null;
};

/** Session-only scheduling projection. It contains neither PCM nor an approval permit. */
export const measuredPreviewAuditionStore = createStore<AuditionState>({
    initialData: { confirmationId: null, operationId: null, targetId: null, side: null, phase: 'idle', error: null },
});
