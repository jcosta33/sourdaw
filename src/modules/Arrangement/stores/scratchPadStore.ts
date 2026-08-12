import { createStore } from '#/infra/store/createStore';

import { type ScratchPadSection } from '../models/ScratchPadSection';

export type ScratchPadStoreState = {
    sections: ScratchPadSection[];
};

export const scratchPadStore = createStore<ScratchPadStoreState>({
    initialData: { sections: [] },
});
