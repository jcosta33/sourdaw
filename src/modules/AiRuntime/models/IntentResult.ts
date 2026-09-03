import { type ActionCommandGraph } from './ActionCommandGraph';
import { type AgentRunProviderProposal } from './AgentRun';
import { type ApplicationToolReceipt } from './ApplicationOwnedTool';
import { type ExecutableRuntimeAction } from './ExecutableRuntimeAction';
import { type PlanningOutcome } from './PlanningOutcome';
import { type WholeProjectVibeMixPlan } from './WholeProjectVibeMixPlan';
import { type WorkflowCapabilityId } from './WorkflowCapability';

export type IntentResult = {
    actions: ExecutableRuntimeAction[];
    rawText: string;
    requiresConfirmation: boolean;
    /** Present when a recognized command was rejected before execution. */
    rejectionReason?: string;
    /** Why this attempt did or did not produce a batch; always present on a planned result. */
    planningOutcome?: PlanningOutcome;
    /** Provider-originated actions that require the atomic, compensable Command batch path. */
    executionMode?: 'atomic';
    /** Application-validated dependency and batch-local producer metadata aligned to actions. */
    actionCommandGraph?: ActionCommandGraph;
    /** Structured, inert explanation for a bounded whole-project proposal. */
    wholeProjectVibeMixPlan?: WholeProjectVibeMixPlan;
    preparationRequest?: 'stem-import';
    workflowCapabilityId?: WorkflowCapabilityId;
    /** Correlated, bounded receipts produced by application-owned read tools during provider planning. */
    applicationToolReceipts?: ApplicationToolReceipt[];
    /** Bounded metadata retained from the normalized provider proposal; never authority on its own. */
    providerProposal?: AgentRunProviderProposal;
    /** Direct stable targets proven from the provider's semantic list against one project snapshot. */
    providerKnownTargetIds?: string[];
};

/** A result produced by the planner itself, which always classifies its own outcome. */
export type PlannedIntentResult = IntentResult & { planningOutcome: PlanningOutcome };
