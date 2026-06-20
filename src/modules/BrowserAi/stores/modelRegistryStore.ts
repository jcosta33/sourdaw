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

        const updatedVoicebanks = state.diffSingerVoicebanks.map((vb) => {
            // A download patch targets exactly one model id. Voicebanks whose five
            // sub-models all have a different id are unaffected, so return the same
            // reference instead of rebuilding the whole models sub-tree — otherwise
            // every voicebank churns on every progress chunk for any model (N×M).
            const m = vb.models;
            const affects =
                m.linguistic.id === modelId ||
                m.dur.id === modelId ||
                m.acoustic.id === modelId ||
                m.pitch.id === modelId ||
                m.variance.id === modelId;
            if (!affects) {
                return vb;
            }

            return {
                ...vb,
                models: {
                    linguistic: m.linguistic.id === modelId ? { ...m.linguistic, ...patch } : m.linguistic,
                    dur: m.dur.id === modelId ? { ...m.dur, ...patch } : m.dur,
                    acoustic: m.acoustic.id === modelId ? { ...m.acoustic, ...patch } : m.acoustic,
                    pitch: m.pitch.id === modelId ? { ...m.pitch, ...patch } : m.pitch,
                    variance: m.variance.id === modelId ? { ...m.variance, ...patch } : m.variance,
                },
            };
        });

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
