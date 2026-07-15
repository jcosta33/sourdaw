import { type FaustModule } from '../../models/FaustEngineTypes';

import type { IFaustCompiler } from '@grame/faustwasm';

export const faustEngineState: {
    modules: Map<string, FaustModule>;
    compilationPromises: Map<string, Promise<boolean>>;
    contextCreateLock: WeakMap<BaseAudioContext, Promise<unknown>>;
    compiler: {
        promise: Promise<IFaustCompiler> | null;
        ready: boolean;
        error: string | null;
    };
} = {
    modules: new Map(),
    compilationPromises: new Map(),
    contextCreateLock: new WeakMap(),
    compiler: {
        promise: null,
        ready: false,
        error: null,
    },
};
