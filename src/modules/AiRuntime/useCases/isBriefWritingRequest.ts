import { type ThreadContext } from '../models/ThreadContext';

import { agentRunLifecycle } from './agentRunLifecycle';
import { getBackendChain } from './llmOrchestration/backendResolution/getBackendChain';

/**
 * A hosted or local request from the chat, or from the Prompt Bar asking to hand it to the chat, may
 * write the production brief. Explain and a decision resume keep the tools and interpretation modes
 * they had, so no profile is offered a mode its tools cannot complete. Automatic stays local, so it
 * offers the brief on the local planner without ever reaching a hosted provider.
 */
export function isBriefWritingRequest(input: {
    thread: ThreadContext | null | undefined;
    runId: string | undefined;
    projectRevision: string | undefined;
    chatHandOff: boolean;
}): boolean {
    const { thread, runId, projectRevision, chatHandOff } = input;
    if ((thread === undefined && !chatHandOff) || projectRevision === undefined || projectRevision === '') {
        return false;
    }
    if (runId !== undefined && (agentRunLifecycle.get(runId)?.resume ?? null) !== null) {
        return false;
    }
    const chain = getBackendChain();
    return (
        chain.length > 0 &&
        (chain.every((backend) => backend === 'cloud') || chain.every((backend) => backend === 'webllm'))
    );
}
