import { type AgentRun } from '../models/AgentRun';
import {
    type AgentRunDiagnosticsOptions,
    type AgentRunDiagnosticsRecord,
    type RedactedText,
} from '../models/AgentRunTelemetry';
import { redactText, withholdText } from '../services/agentRunRedaction/redactSecrets';

import { projectAgentRunTelemetry } from './projectAgentRunTelemetry';

/**
 * Project one run for a developer reading it.
 *
 * The telemetry tier carries the record's operational evidence unchanged. The
 * free text this tier adds is withheld by default and redacted when the caller
 * asks for project content; both paths run the same secret redaction, so no
 * option emits a credential.
 */
export function projectAgentRunDiagnostics(
    run: AgentRun,
    options?: AgentRunDiagnosticsOptions
): AgentRunDiagnosticsRecord {
    const carry: (text: string) => RedactedText = options?.includeProjectContent === true ? redactText : withholdText;

    return {
        ...projectAgentRunTelemetry(run),
        tier: 'diagnostics',
        detail: {
            request: carry(run.request),
            planDescriptions: run.plan === null ? [] : run.plan.steps.map((step) => carry(step.description)),
            decisionReason: run.decision === null ? null : carry(run.decision.reason),
            errorMessages: run.errors.map((error) => carry(error.message)),
            cancellationReason: run.cancellation.reason === null ? null : carry(run.cancellation.reason),
        },
    };
}
