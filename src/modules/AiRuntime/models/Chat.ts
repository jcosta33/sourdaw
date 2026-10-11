import { type AnswerEvidenceEntry } from './PlanningOutcome';

export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatActionConfirmationStatus =
    'proposed' | 'accepted' | 'executed' | 'failed' | 'cancelled' | 'invalidated';

export type ChatActionFollowUpStatus = 'retryable' | 'running' | 'complete' | 'failed';

export type ChatMessage = {
    id: string;
    role: ChatRole;
    content: string;
    timestamp: number;
    isStreaming?: boolean;
    error?: string;
    /** Hidden reasoning tokens from the model (collapsible in UI) */
    reasoning?: string;
    /** Tool receipts an answer rests on; the panel lists them in a collapsed disclosure. */
    answerEvidence?: readonly AnswerEvidenceEntry[];
    /** Whether this message is an executable prompt-command receipt rather than ordinary chat. */
    isCommandAction?: boolean;
    /** The agent run a command message reports, so the thread can name the run it committed. */
    agentRunId?: string;
    /**
     * The command batch this message committed to the project without a confirmation, stamped once
     * it committed, so the thread reports that batch's own receipt and never another batch of its
     * run. A runtime-only batch, which changes no project state, never stamps it.
     */
    agentBatchId?: string;
    /** The identity of the project that run planned against, so another project's commit never reads as this one's. */
    projectId?: string;
    /** Pending prompt-action confirmation owned by AiRuntime. */
    pendingActionConfirmationId?: string;
    pendingActionConfirmationStatus?: ChatActionConfirmationStatus;
    pendingActionFollowUpStatus?: ChatActionFollowUpStatus;
};

export type ChatState = {
    messages: ChatMessage[];
    isGenerating: boolean;
    enableReasoning: boolean;
    chatMode: 'chat' | 'prompt';
};
