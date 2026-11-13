import { type renderAgentPreviewMeasurementScope } from '#/modules/AudioRendering/useCases';
import { digest } from '#/utils/canonicalDigest';

import { ANALYSIS_MEASURE_TOOL_NAME } from '../models/AgentToolCatalogNames';
import { type AnalysisMeasureRead } from '../models/AnalysisMeasureRead';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type MeasuredPreview } from '../models/MeasuredPreview';
import { type RetainedCommand } from '../models/RetainedCompilation';

import { type artifactOf } from './artifactOf';
import { materializeTransformToolCalls } from './materializeTransformToolCalls';
import { type parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];
type RenderedPreview = Extract<Awaited<ReturnType<typeof renderAgentPreviewMeasurementScope>>, { status: 'rendered' }>;

function measuredPreviewWithSource(
    base: Omit<MeasuredPreview, 'recipeSource'>,
    recipeSource: MeasuredPreview['recipeSource']
): MeasuredPreview {
    if (recipeSource === undefined) {
        return base;
    }
    return { ...base, recipeSource };
}

/** Everything one preview receipt reports, whichever renders its figures were read from. */
export type PreviewReadCore = {
    callId: string;
    turn: number;
    projectRevision: string;
    origin: 'planner' | 'approval-preview';
    runId: string;
    scope: ParsedArguments['scope'];
    metrics: ParsedArguments['metrics'];
    beats: MeasuredPreview['range'];
    commands: readonly RetainedCommand[];
    batchContentHash: string;
    recipeSource?: MeasuredPreview['recipeSource'];
    targets: MeasuredPreview['targets'];
    /** Each target's two cited renders, in `targets` order. */
    renders: readonly {
        targetId: string;
        baseline: ReturnType<typeof artifactOf>;
        preview: ReturnType<typeof artifactOf>;
    }[];
    baselineSeconds: RenderedPreview['baseline']['rangeSeconds'];
    previewSeconds: RenderedPreview['preview']['rangeSeconds'];
    warnings: string[];
};

export function measuredPreviewRead(core: PreviewReadCore): AnalysisMeasureRead {
    const { commands, batchContentHash, targets } = core;
    const { startBeat, endBeat, sectionId } = core.beats;
    const measuredPreview: MeasuredPreview = measuredPreviewWithSource(
        {
            provenance: {
                origin: core.origin,
                callId: core.callId,
                turn: core.turn,
                runId: core.runId,
                targets: core.renders.map((render) => ({
                    targetId: render.targetId,
                    baseline: render.baseline,
                    preview: render.preview,
                })),
            },
            scope: core.scope,
            range: { startBeat, endBeat, sectionId },
            targets,
            batchContentHash,
            revision: core.projectRevision,
        },
        core.recipeSource
    );
    const measuredSummary = `Measured the proposal preview against the project for ${String(targets.length)} target(s) over beats ${String(startBeat)} to ${String(endBeat)}.`;
    const data = {
        kind: 'analysis-measurement',
        schemaVersion: 1,
        subject: 'preview',
        scope: core.scope,
        sourceRevisionDigest: digest(core.projectRevision),
        range: {
            startBeat,
            endBeat,
            sectionId,
            baselineSeconds: core.baselineSeconds,
            previewSeconds: core.previewSeconds,
        },
        metrics: core.metrics,
        targets: targets.map((target, index) => ({
            targetId: target.targetId,
            targetKind: target.targetKind,
            baseline: target.baseline,
            preview: target.preview,
            deltas: target.deltas,
            baselineRender: core.renders[index]!.baseline,
            previewRender: core.renders[index]!.preview,
        })),
    };
    const receipt: ApplicationToolReceipt = {
        schema: 'sourdaw.application-tool-receipt',
        schemaVersion: 1,
        callId: core.callId,
        toolName: ANALYSIS_MEASURE_TOOL_NAME,
        turn: core.turn,
        status: 'success',
        revision: core.projectRevision,
        data,
        summary: measuredSummary,
        warnings: core.warnings,
        error: null,
    };
    if (core.origin === 'approval-preview') {
        // The card already holds the batch and no provider adopts it, so its proof is figures alone.
        return { receipt, commands, measuredPreview };
    }
    const adoptable: ApplicationToolReceipt = {
        ...receipt,
        data: {
            ...data,
            commands: materializeTransformToolCalls([
                { callId: core.callId, revision: core.projectRevision, commands },
            ]),
        },
        summary: `${measuredSummary} Adopt exactly these commands with compiledCallIds ["${core.callId}"].`,
    };
    return { receipt: adoptable, commands, measuredPreview };
}
