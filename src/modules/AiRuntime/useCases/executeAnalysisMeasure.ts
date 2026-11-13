import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type MeasurementAdmitter } from '../models/MeasurementBudget';
import { type ProjectContextSection } from '../models/ProjectContext';
import { type ToolCallResult } from '../models/ToolCallResult';

import { type AnalysisMeasureRead } from './answerContractTypes';
import { executePreviewMeasurement } from './executePreviewMeasurement';
import { measurementFailureReceipt } from './measurementFailureReceipt';
import { measureProjectScope } from './measureProjectScope';
import { parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';
import { projectMeasurementReceipt } from './projectMeasurementReceipt';

type ExecuteAnalysisMeasureInput = {
    call: ToolCallResult;
    callId: string;
    turn: number;
    /** The revision the planning loop read the project at. */
    projectRevision: string;
    /** The sections the loop's project reads report, which a `sectionId` range names. */
    sections: readonly ProjectContextSection[];
    signal?: AbortSignal;
    /** The run's admission of this measurement's renders and reductions; absent outside a run, which spends no budget. */
    admit?: MeasurementAdmitter;
    /** What a `preview` subject compiles and grounds its proposal against; absent, previews are unavailable. */
    preview?: Parameters<typeof executePreviewMeasurement>[0]['preview'];
};

function read(receipt: ApplicationToolReceipt): AnalysisMeasureRead {
    return { receipt, commands: null, measuredPreview: null };
}

/**
 * Execute one `analysis.measure` call: render the named scope offline at the
 * loop's project revision and reduce each render to objective figures.
 *
 * The receipt carries figures and each render's content address, never
 * samples; the render itself stays in AudioRendering's measurement retention.
 * A `preview` subject renders a semantic list or retained recipe in isolation beside the project
 * and returns, besides the receipt, the commands it measured for a proposal
 * to adopt; a `project` subject returns its receipt alone, as it always has.
 */
export async function executeAnalysisMeasure(input: ExecuteAnalysisMeasureInput): Promise<AnalysisMeasureRead> {
    const parsed = parseAnalysisMeasureArguments(input.call.arguments);
    if (parsed.status === 'invalid') {
        return read(
            measurementFailureReceipt(input, { code: 'invalid-arguments', safeMessage: parsed.reason, retryable: true })
        );
    }
    const { subject } = parsed.value;
    if (subject.kind === 'preview') {
        if (input.preview === undefined) {
            return read(
                measurementFailureReceipt(input, {
                    code: 'preview-unavailable',
                    safeMessage: 'Measuring a proposal preview is unavailable to this run.',
                    retryable: false,
                })
            );
        }
        return executePreviewMeasurement({
            ...input,
            preview: input.preview,
            parsed: parsed.value,
            source: subject,
        });
    }
    const measured = await measureProjectScope(input, parsed.value);
    if (measured.status === 'failed') {
        return read(measurementFailureReceipt(input, measured.failure));
    }
    return {
        ...read(projectMeasurementReceipt(input, parsed.value, measured.measurement)),
        answerMeasurement: {
            revision: input.projectRevision,
            scope: parsed.value.scope,
            range: measured.measurement.range,
            metrics: parsed.value.metrics,
            targets: measured.measurement.targets,
        },
    };
}
