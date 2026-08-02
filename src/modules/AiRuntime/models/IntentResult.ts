import { type ExecutableRuntimeAction } from './ExecutableRuntimeAction';

export type IntentResult = {
    actions: ExecutableRuntimeAction[];
    rawText: string;
    requiresConfirmation: boolean;
    /** Present when a recognized command was rejected before execution. */
    rejectionReason?: string;
    /** Provider-originated actions that require the atomic, compensable Command batch path. */
    executionMode?: 'atomic';
    /** Set when the JSON editor flow was used and changes were already applied */
    _jsonEditApplied?: boolean;
    /** Human-readable summaries of applied JSON edit changes */
    _jsonEditSummaries?: string[];
    /** True if the DSO editor ran, so we don't output generic fallback errors */
    _jsonEditAttempted?: boolean;
};
