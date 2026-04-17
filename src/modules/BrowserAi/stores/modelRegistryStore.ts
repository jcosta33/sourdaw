/**
 * Store for the model registry — tracks download status of all known models.
 */

import { createStore } from '#/infra/store/createStore';
import { type BrowserModel, type DdspInstrument, type DiffSingerVoicebank, type KokoroModel, type VocoderModel } from '../models/BrowserModel';

export type ModelRegistryState = {
    ddspInstruments: DdspInstrument[];
    kokoroModel: KokoroModel | null;
    diffSingerVoicebanks: DiffSingerVoicebank[];
    vocoder: VocoderModel | null;
    /** Total bytes used by downloaded models in OPFS */
    storageUsedBytes: number;
};

export const modelRegistryStore = createStore<ModelRegistryState>({
    initialData: {
        ddspInstruments: [],
        kokoroModel: null,
        diffSingerVoicebanks: [],
        vocoder: null,
        storageUsedBytes: 0,
    },
});

export function updateModelStatus(modelId: string, patch: Partial<Pick<BrowserModel, 'status' | 'downloadProgress'>>): void {
    modelRegistryStore.update((state) => {
        if (!state) {
            return state;
        }

        const updatedInstruments = state.ddspInstruments.map((m) =>
            m.id === modelId ? { ...m, ...patch } : m
        );

        const updatedVoicebanks = state.diffSingerVoicebanks.map((vb) => {
            // Skip voicebanks that don't contain this modelId
            const allModelIds = [vb.models.linguistic.id, vb.models.dur.id, vb.models.acoustic.id, vb.models.pitch.id, vb.models.variance.id];
            if (!allModelIds.includes(modelId)) {
                return vb;
            }
            const models = {
                linguistic: vb.models.linguistic.id === modelId ? { ...vb.models.linguistic, ...patch } : vb.models.linguistic,
                dur: vb.models.dur.id === modelId ? { ...vb.models.dur, ...patch } : vb.models.dur,
                acoustic: vb.models.acoustic.id === modelId ? { ...vb.models.acoustic, ...patch } : vb.models.acoustic,
                pitch: vb.models.pitch.id === modelId ? { ...vb.models.pitch, ...patch } : vb.models.pitch,
                variance: vb.models.variance.id === modelId ? { ...vb.models.variance, ...patch } : vb.models.variance,
            };
            // Derive voicebank-level status from its constituent models
            const allModels = Object.values(models);
            const allReady = allModels.every((m) => m.status === 'ready');
            const anyError = allModels.some((m) => m.status === 'error');
            const anyDownloading = allModels.some((m) => m.status === 'downloading');
            const vbStatus = allReady ? 'ready' as const
                : anyError ? 'error' as const
                : anyDownloading ? 'downloading' as const
                : vb.status;
            const vbProgress = anyDownloading
                ? allModels.reduce((sum, m) => sum + (m.downloadProgress ?? 0), 0) / allModels.length
                : allReady ? 1 : vb.downloadProgress;
            return { ...vb, models, status: vbStatus, downloadProgress: vbProgress };
        });

        const kokoroModel = state.kokoroModel?.id === modelId
            ? { ...state.kokoroModel, ...patch }
            : state.kokoroModel;

        const vocoder = state.vocoder?.id === modelId
            ? { ...state.vocoder, ...patch }
            : state.vocoder;

        return {
            ...state,
            ddspInstruments: updatedInstruments,
            diffSingerVoicebanks: updatedVoicebanks,
            kokoroModel,
            vocoder,
        };
    });
}

export function setStorageUsed(bytes: number): void {
    modelRegistryStore.update((state) => state ? { ...state, storageUsedBytes: bytes } : state);
}
