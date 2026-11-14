import { ANALYSIS_MEASURE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type MeasurementFailure } from '../models/MeasurementBudget';

/** The receipt of a measurement that failed, as `analysis.measure` reports one. */
export function measurementFailureReceipt(
    input: { callId: string; turn: number },
    failure: MeasurementFailure
): ApplicationToolReceipt {
    return {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: input.callId,
        toolName: ANALYSIS_MEASURE_TOOL_NAME,
        turn: input.turn,
        status: 'failure',
        revision: null,
        data: null,
        summary: failure.safeMessage,
        warnings: [],
        error: failure,
    };
}
