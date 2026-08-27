import { agentRunLifecycle } from './agentRunLifecycle';
import { recoverPreparedStemImportResources } from './recoverPreparedStemImportResources';

export async function recoverInterruptedAgentRuns(input?: {
    recoveredAt?: number;
}): Promise<{ recoveredRunIds: string[] }> {
    const recovery = agentRunLifecycle.recoverInterruptedState(input);
    await recoverPreparedStemImportResources();
    return recovery;
}
