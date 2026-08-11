import { type DocId } from '../../models/CrdtDocumentTypes';
import { type BranchStoreState } from '../../stores/branchStore';

import { runBranchTransition } from './runBranchTransition';

type RunBranchDocumentTransitionInput<TResult> = {
    affectedDocIds: DocId[];
    apply: () => { nextState?: BranchStoreState; result: TResult };
    previousState: BranchStoreState;
    transitionOwnerId?: string;
};

export function runBranchDocumentTransition<TResult>({
    affectedDocIds,
    apply,
    previousState,
    transitionOwnerId,
}: RunBranchDocumentTransitionInput<TResult>): Promise<TResult> {
    return runBranchTransition({
        affectedDocIds,
        apply,
        previousState,
        persistenceOperation: () => Promise.resolve(),
        transitionOwnerId,
    });
}
