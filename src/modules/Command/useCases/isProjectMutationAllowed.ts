import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';

export function isProjectMutationAllowed(): boolean {
    return agentProjectRepairStateStore.value === null;
}
