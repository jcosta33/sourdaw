import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument/models/CrdtDocumentTypes';

import { type TimeSignatureChange } from '../models/TimeSignatureMap';

const logger = Container.getInstance().get(Logger);

export type TimeSignatureMapStoreState = {
    changes: TimeSignatureChange[];
};

export const timeSignatureMapStore = new Store<TimeSignatureMapStoreState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'timeSignatureMap'),
    initialData: { changes: [] },
});
