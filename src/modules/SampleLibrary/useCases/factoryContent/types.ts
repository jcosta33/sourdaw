export type FactorySampleCategory = 'drums' | 'bass' | 'keys' | 'vocal-loop' | 'fx';

export type FactorySample = {
    id: string;
    name: string;
    category: FactorySampleCategory;
    tags: string[];
    bpm?: number;
    pitch?: number;
    buffer: AudioBuffer;
};

export type FactoryPackKey =
    | 'drums-909'
    | 'drums-808'
    | 'drums-acoustic'
    | 'drums-lofi'
    | 'perc-world'
    | 'perc-electronic'
    | 'bass'
    | 'keys'
    | 'fx-risers'
    | 'fx-impacts';

export const FACTORY_LIBRARY_ROOT_ID = 'factory';
export const FACTORY_SEED_FLAG_KEY = 'wd:factory-library-seeded';
