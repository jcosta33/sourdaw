import {
    AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
    ANALYSIS_MEASURE_TOOL_NAME,
    ANSWER_RESPOND_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    PROJECT_QUERY_TOOL_NAME,
    RECIPE_DISCOVERY_TOOL_NAME,
} from './AgentToolCatalogNames';
import { type PlannedIntentResult } from './IntentResult';

/** Selected by the application execution mode, never by provider text, grants or a resume. */
export type PlanningProfile = 'readonly-answer';

export const READONLY_ANSWER_TOOL_NAMES: ReadonlySet<string> = new Set([
    PROJECT_QUERY_TOOL_NAME,
    ANALYSIS_MEASURE_TOOL_NAME,
    RECIPE_DISCOVERY_TOOL_NAME,
    AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
    ANSWER_RESPOND_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
]);
export const READONLY_ANSWER_TERMINAL_NAMES: ReadonlySet<string> = new Set([
    ANSWER_RESPOND_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
]);
export const READONLY_ANSWER_MAX_OUTPUT_TOKENS = 2048;

const READONLY_RESULT_FIELDS: ReadonlySet<string> = new Set([
    'actions',
    'rawText',
    'requiresConfirmation',
    'planningOutcome',
    'rejectionReason',
    'rejectionEvidence',
    'applicationToolReceipts',
]);

/** Fail closed before preparation or dispatch even if an internal producer violates the profile. */
export function guardReadonlyPlanningResult(result: PlannedIntentResult): PlannedIntentResult {
    const kind = result.planningOutcome.kind;
    if (
        result.actions.length === 0 &&
        result.requiresConfirmation === false &&
        Object.keys(result).every((field) => READONLY_RESULT_FIELDS.has(field)) &&
        (kind === 'answer' || kind === 'denied' || kind === 'clarify' || kind === 'unsupported')
    ) {
        return result;
    }
    const reason = 'Explain can only answer or decline without preparing or proposing changes.';
    return {
        actions: [],
        rawText: result.rawText,
        requiresConfirmation: false,
        applicationToolReceipts: result.applicationToolReceipts,
        rejectionReason: reason,
        planningOutcome: { kind: 'denied', reason },
    };
}
