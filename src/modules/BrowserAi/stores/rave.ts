/**
 * RAVE neural audio synthesis store.
 *
 * Extracted from raveUseCases.ts.
 *
 * NO RAVE MODEL IS SHIPPED OR HOSTED. `FACTORY_MODELS` below is a catalog of
 * models this module is *prepared* to run, not a list of models that exist.
 * `models` is populated exclusively by `initRaveModels`, which registers only
 * the entries whose weights are actually present in OPFS — so with nothing
 * downloaded the list is empty and no RAVE surface is offered anywhere.
 *
 * NOTES:
 * - `encodeAudio` / `decodeLatent` are unwired placeholders, NOT a neural codec
 *   (see the notice on each). They have no production caller.
 * - `randomizeLatent` uses Math.random() — non-deterministic
 */

import { logger as raveLogger } from '#/infra/logger/appLogger';
import { createStore } from '#/infra/store/createStore';

export type RaveModel = {
    id: string;
    name: string;
    category: 'strings' | 'vocals' | 'synth' | 'percussion' | 'ambient' | 'custom';
    latentDim: number;
    sampleRate: number;
    sizeMb: number;
    loaded: boolean;
    modelPath: string;
};

export type LatentVector = {
    values: number[];
    timeSec: number;
};

export type RaveState = {
    models: RaveModel[];
    activeModelId: string | null;
    transferBlend: number;
    temperature: number;
    realTimeEnabled: boolean;
    latentCache: LatentVector[];
};

export const raveStore = createStore<RaveState>({
    initialData: {
        models: [],
        activeModelId: null,
        transferBlend: 0.5,
        temperature: 1.0,
        realTimeEnabled: false,
        latentCache: [],
    },
});

export { raveLogger };

/** OPFS family directory the RAVE weights would live under, once any are hosted. */
export const RAVE_MODEL_FAMILY = 'rave';

/**
 * Catalog of RAVE models this module can run. Presence is *not* implied —
 * `initRaveModels` probes OPFS and registers only the ones that are there.
 */
export const FACTORY_MODELS: Omit<RaveModel, 'loaded'>[] = [
    {
        id: 'rave-strings',
        name: 'Orchestral Strings',
        category: 'strings',
        latentDim: 16,
        sampleRate: 48000,
        sizeMb: 45,
        modelPath: 'models/rave/strings.onnx',
    },
    {
        id: 'rave-vocals',
        name: 'Vocal Synthesis',
        category: 'vocals',
        latentDim: 16,
        sampleRate: 48000,
        sizeMb: 52,
        modelPath: 'models/rave/vocals.onnx',
    },
    {
        id: 'rave-synth',
        name: 'Analog Synth',
        category: 'synth',
        latentDim: 8,
        sampleRate: 44100,
        sizeMb: 30,
        modelPath: 'models/rave/synth.onnx',
    },
    {
        id: 'rave-percussion',
        name: 'Percussion',
        category: 'percussion',
        latentDim: 8,
        sampleRate: 44100,
        sizeMb: 28,
        modelPath: 'models/rave/percussion.onnx',
    },
    {
        id: 'rave-ambient',
        name: 'Ambient Textures',
        category: 'ambient',
        latentDim: 32,
        sampleRate: 48000,
        sizeMb: 60,
        modelPath: 'models/rave/ambient.onnx',
    },
];
