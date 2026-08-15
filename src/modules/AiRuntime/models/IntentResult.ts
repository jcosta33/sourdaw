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
    /** Structured, inert explanation for a bounded whole-project proposal. */
    wholeProjectVibeMixPlan?: WholeProjectVibeMixPlan;
    preparationRequest?: 'stem-import';
    workflowCapabilityId?: WorkflowCapabilityId;
    /** Correlated, bounded receipts produced by application-owned read tools during provider planning. */
    applicationToolReceipts?: ApplicationToolReceipt[];
};
