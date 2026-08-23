import { type ActionCommandGraph } from './ActionCommandGraph';
import { type AgentRunProviderProposal } from './AgentRun';
import { type ApplicationToolReceipt } from './ApplicationOwnedTool';
import { type ExecutableRuntimeAction } from './ExecutableRuntimeAction';
import { type WholeProjectVibeMixPlan } from './WholeProjectVibeMixPlan';
import { type WorkflowCapabilityId } from './WorkflowCapability';

export type IntentResult = {
    actions: ExecutableRuntimeAction[];
    rawText: string;
    requiresConfirmation: boolean;
    /** Present when a recognized command was rejected before execution. */
    rejectionReason?: string;
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
};
