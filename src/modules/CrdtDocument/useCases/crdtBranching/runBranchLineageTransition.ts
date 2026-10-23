import { type DocId } from '../../models/CrdtDocumentTypes';
import { type BranchStoreState } from '../../stores/branchStore';
import { runCrdtPersistenceOperation } from '../runCrdtPersistenceOperation';

import { runBranchTransition } from './runBranchTransition';

type RunBranchLineageTransitionInput<TResult> = {
    affectedDocIds: DocId[];
    apply: () => { nextState?: BranchStoreState; result: TResult };
    from: string;
    previousState: BranchStoreState;
    stopTransportBeforeRollback?: () => Promise<void>;
    to: string;
};

export function runBranchLineageTransition<TResult>({
    affectedDocIds,
    apply,
    from,
    previousState,
    stopTransportBeforeRollback,
    to,
}: RunBranchLineageTransitionInput<TResult>): Promise<TResult> {
    return runBranchTransition({
        affectedDocIds,
        apply,
        previousState,
        stopTransportBeforeRollback,
        persistenceOperation: () => runCrdtPersistenceOperation({ type: 'root-lineage-transition', from, to }),
    });
}
