import { FACTORY_LIBRARY_ROOT_ID } from '#/modules/FactorySynthesis/useCases';

import { type LibraryRoot } from '../../models/LibraryTypes';
import { libraryStore } from '../../stores/libraryStore';

export function findFactoryRoot(): LibraryRoot | undefined {
    return libraryStore.value?.roots.find((root) => root.id === FACTORY_LIBRARY_ROOT_ID);
}
