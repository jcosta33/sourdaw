import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type Macro } from '../models/Macro';
import { type AppAction } from '../models/AppAction';

const logger = Container.getInstance().get(Logger);

export type MacroStoreState = {
    macros: Macro[];
    recording: boolean;
    currentRecording: AppAction[];
};

export const macroStore = new Store<MacroStoreState>(logger, {
    initialData: { macros: [], recording: false, currentRecording: [] },
});
