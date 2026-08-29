import { agentRunLifecycle } from './agentRunLifecycle';
import { type AgentRunReceiptSagaInput } from './projectAgentRunReceiptSaga';

/** The sole AgentRun receipt writer for both direct and confirmed command execution. */
export function recordAgentRunReceiptSaga(input: AgentRunReceiptSagaInput): { effectsPending: boolean } {
    return agentRunLifecycle.recordReceiptSaga(input);
}
