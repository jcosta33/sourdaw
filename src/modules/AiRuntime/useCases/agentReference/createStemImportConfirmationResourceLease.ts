import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { discardPreparedStemImportResources } from './discardPreparedStemImportResources';

export function createStemImportConfirmationResourceLease(actions: readonly ExecutableRuntimeAction[]) {
    const stems = actions.flatMap((action) => (action.type === 'importStemSet' ? action.payload.stems : []));
    if (stems.length === 0) {
        return undefined;
    }

    let released = false;
    return {
        bytes: stems.reduce((total, stem) => total + stem.sourceBytes + stem.decodedBytes, 0),
        release: async () => {
            if (released) {
                return;
            }
            await discardPreparedStemImportResources(stems);
            released = true;
        },
    };
}
