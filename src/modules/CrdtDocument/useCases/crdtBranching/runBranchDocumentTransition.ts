import { type DocId } from '../../models/CrdtDocumentTypes';
import { type BranchStoreState } from '../../stores/branchStore';

import { runBranchTransition } from './runBranchTransition';

type RunBranchDocumentTransitionInput<TResult> = {
    affectedDocIds: DocId[];
    apply: () => { nextState?: BranchStoreState; result: TResult };
    previousState: BranchStoreState;
};

export function runBranchDocumentTransition<TResult>({
    affectedDocIds,
    apply,
    previousState,
}: RunBranchDocumentTransitionInput<TResult>): Promise<TResult> {
    return runBranchTransition({
        affectedDocIds,
        apply,
        previousState,
        persistenceOperation: () => Promise.resolve(),
    });
}
