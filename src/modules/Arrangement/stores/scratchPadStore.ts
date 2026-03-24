import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type ScratchPadSection } from '../models/ScratchPadSection';

const logger = Container.getInstance().get(Logger);

export type ScratchPadStoreState = {
    sections: ScratchPadSection[];
};

export const scratchPadStore = new Store<ScratchPadStoreState>(logger, {
    initialData: { sections: [] },
});
