import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';

export const PROJECT_REPAIR_REQUIRED_MESSAGE = 'Project repair is required before project actions can execute';

export function getProjectMutationAdmissionFailure(): string | null {
    return agentProjectRepairStateStore.value === null ? null : PROJECT_REPAIR_REQUIRED_MESSAGE;
}
