/**
 * Store for the model registry — tracks download status of all known models.
 */

import { createStore } from '#/infra/store/createStore';

import {
    type BrowserModel,
    type DdspInstrument,
    type DiffSingerVoicebank,
    type KokoroModel,
    type VocoderModel,
} from '../models/BrowserModel';

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

export function updateModelStatus(
    modelId: string,
    patch: Partial<Pick<BrowserModel, 'status' | 'downloadProgress'>>
): void {
    modelRegistryStore.update((state) => {
        if (!state) {
            return state;
        }

        const updatedInstruments = state.ddspInstruments.map((message) =>
            message.id === modelId ? { ...message, ...patch } : message
        );

        const updatedVoicebanks = state.diffSingerVoicebanks.map((vb) => ({
            ...vb,
            models: {
                linguistic:
                    vb.models.linguistic.id === modelId ? { ...vb.models.linguistic, ...patch } : vb.models.linguistic,
                dur: vb.models.dur.id === modelId ? { ...vb.models.dur, ...patch } : vb.models.dur,
                acoustic: vb.models.acoustic.id === modelId ? { ...vb.models.acoustic, ...patch } : vb.models.acoustic,
                pitch: vb.models.pitch.id === modelId ? { ...vb.models.pitch, ...patch } : vb.models.pitch,
                variance: vb.models.variance.id === modelId ? { ...vb.models.variance, ...patch } : vb.models.variance,
            },
        }));

        const kokoroModel = state.kokoroModel?.id === modelId ? { ...state.kokoroModel, ...patch } : state.kokoroModel;

        const vocoder = state.vocoder?.id === modelId ? { ...state.vocoder, ...patch } : state.vocoder;

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
    modelRegistryStore.update((state) => (state ? { ...state, storageUsedBytes: bytes } : state));
}
