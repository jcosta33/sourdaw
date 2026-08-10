import { type ExecutableRuntimeAction } from './ExecutableRuntimeAction';
import { type WholeProjectVibeMixPlan } from './WholeProjectVibeMixPlan';

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
};
