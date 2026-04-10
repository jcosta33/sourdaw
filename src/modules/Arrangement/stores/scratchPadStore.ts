import { createStore } from '#/infra/store/createStore';
import { type ScratchPadSection } from '../useCases/scratchPad/scratchPadCrud';

export type ScratchPadStoreState = {
    sections: ScratchPadSection[];
};

export const scratchPadStore = createStore<ScratchPadStoreState>({
    initialData: { sections: [] },
});
