import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';

import { productionBriefAdmissionPort } from './productionBriefAdmissionPort';

/**
 * Calls `listener` whenever something the dispatch gate's admission reads may
 * have changed: the project repair state or the production brief. It does not
 * say what is admitted now; ask `isAppActionAdmitted`.
 */
export function subscribeAppActionAdmissionChanges(listener: () => void): () => void {
    const stopRepair = agentProjectRepairStateStore.subscribe(listener);
    const stopBrief = productionBriefAdmissionPort.subscribe(listener);
    return () => {
        stopRepair();
        stopBrief();
    };
}
