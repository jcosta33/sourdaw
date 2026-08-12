import { type ExecutableRuntimeAction } from './ExecutableRuntimeAction';
import { type ProjectContextAgentReferenceHistoryEntry } from './ProjectContext';
import { type WholeProjectVibeMixPlan } from './WholeProjectVibeMixPlan';
import { type WorkflowCapabilityId } from './WorkflowCapability';

export type IntentResult = {
    actions: ExecutableRuntimeAction[];
    rawText: string;
    requiresConfirmation: boolean;
    /** Present when a recognized command was rejected before execution. */
    rejectionReason?: string;
    /** App-owned stable-ID candidates when target authority needs user disambiguation or preview. */
    referenceResolutionRequest?: {
        kind: 'clarification' | 'preview';
        argument: string;
        candidates: Array<{
            id: string;
            confidence: number;
            evidence: Array<{ kind: string; value: string }>;
        }>;
    };
    /** App-grounded reference receipts; committed to recency only after revision revalidation. */
    resolvedAgentReferences?: Array<Omit<ProjectContextAgentReferenceHistoryEntry, 'referencedAt'>>;
    /** Provider-originated actions that require the atomic, compensable Command batch path. */
    executionMode?: 'atomic';
    /** Structured, inert explanation for a bounded whole-project proposal. */
    wholeProjectVibeMixPlan?: WholeProjectVibeMixPlan;
    preparationRequest?: 'stem-import';
    workflowCapabilityId?: WorkflowCapabilityId;
};
