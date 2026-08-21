import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';

import { preparedStemImportResources } from './registerPreparedStemImportResources';

export function createStemImportConfirmationResourceLease(runId: string, actions: readonly ExecutableRuntimeAction[]) {
    const stems = actions.flatMap((action) => (action.type === 'importStemSet' ? action.payload.stems : []));
    if (stems.length === 0) {
        return undefined;
    }

    return {
        bytes: stems.reduce((total, stem) => total + stem.sourceBytes + stem.decodedBytes, 0),
        protect: () => preparedStemImportResources.protect({ runId, stems }),
        retain: () => preparedStemImportResources.retainForRecovery({ runId, stems }),
        transfer: () => preparedStemImportResources.release({ runId, stems }),
        release: () => void preparedStemImportResources.discard({ runId, stems }),
    };
}
