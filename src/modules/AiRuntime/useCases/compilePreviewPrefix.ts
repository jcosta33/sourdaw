import { type MeasurementFailure } from '../models/MeasurementBudget';
import { type RetainedCommand } from '../models/RetainedCompilation';

import { compilePreviewMeasurementProposal } from './compilePreviewMeasurementProposal';
import { digestCommandBatchContent } from './digestCommandBatchContent';
import { type ExecutePreviewMeasurementInput } from './executePreviewMeasurement';

type PreparedBatch = NonNullable<ExecutePreviewMeasurementInput['preview']['preparedBatch']>;

/** One prefix document of a preview unit, compiled as the preview measurement compiles a prepared batch. */
export type CompiledPrefix = {
    commands: readonly RetainedCommand[];
    envelope: PreparedBatch;
    batchContentHash: string;
};

/**
 * Compiles the prepared batch a prefix names, exactly as one preview measurement of it would. The
 * same inputs compile the same document, so the planner reading a prefix's timeline and the unit
 * rendering it read one document.
 */
export function compilePreviewPrefix(input: {
    prefix: string;
    preparedBatch: PreparedBatch | undefined;
    projectRevision: string;
    preview: Pick<ExecutePreviewMeasurementInput['preview'], 'context' | 'prompt' | 'runId' | 'readCreativeAuthority'>;
}): CompiledPrefix | MeasurementFailure {
    if (input.preparedBatch === undefined) {
        return { code: 'preview-unavailable', safeMessage: 'The preview prefix is unavailable.', retryable: false };
    }
    const result = compilePreviewMeasurementProposal({
        callId: `goal-measure-${input.prefix}`,
        source: { preparedBatch: input.preparedBatch },
        context: input.preview.context,
        prompt: input.preview.prompt,
        revision: input.projectRevision,
        runId: input.preview.runId,
        creativeAuthority: input.preview.readCreativeAuthority(),
    });
    if (result.status === 'rejected') {
        return { code: 'preview-proposal-rejected', safeMessage: result.reason, retryable: true };
    }
    return {
        commands: result.commands,
        envelope: result.envelope,
        batchContentHash: digestCommandBatchContent(result.envelope),
    };
}
