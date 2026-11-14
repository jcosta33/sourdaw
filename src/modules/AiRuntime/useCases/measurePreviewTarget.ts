import { compareAgentScopeMeasurements, measureAgentScopeRender } from '#/modules/AudioAnalysis/useCases';
import { type renderAgentPreviewMeasurementScope } from '#/modules/AudioRendering/useCases';

import { type MeasuredPreview } from '../models/MeasuredPreview';

import { type parseAnalysisMeasureArguments } from './parseAnalysisMeasureArguments';

type ParsedArguments = Extract<ReturnType<typeof parseAnalysisMeasureArguments>, { status: 'valid' }>['value'];
type RenderedPreview = Extract<Awaited<ReturnType<typeof renderAgentPreviewMeasurementScope>>, { status: 'rendered' }>;
/** One target's render in one document of a preview measurement. */
export type RenderedPreviewTarget = RenderedPreview['baseline']['targets'][number];

function auditionRender(target: RenderedPreviewTarget) {
    return {
        route: target.route,
        artifact: { contentAddress: target.artifact.contentAddress },
        sampleRate: target.buffer.sampleRate,
        frameCount: target.buffer.length,
        channelCount: target.buffer.numberOfChannels,
        durationSeconds: target.buffer.duration,
    };
}

export function measurePreviewTarget(
    baseline: RenderedPreviewTarget,
    preview: RenderedPreviewTarget,
    metrics: ParsedArguments['metrics']
): MeasuredPreview['targets'][number] {
    const analysisMetrics: ParsedArguments['metrics'] = [...new Set([...metrics, 'integratedLoudness' as const])];
    const baselineAll = measureAgentScopeRender(baseline.buffer, analysisMetrics);
    const previewAll = measureAgentScopeRender(preview.buffer, analysisMetrics);
    const requested = (measurements: typeof baselineAll) =>
        Object.fromEntries(
            metrics.flatMap((metric) => {
                const entry = measurements[metric];
                return entry === undefined ? [] : [[metric, entry] as const];
            })
        );
    const baselineMeasurements = requested(baselineAll);
    const previewMeasurements = requested(previewAll);
    const unavailable = { status: 'unavailable', reason: 'Integrated loudness is unavailable.' } as const;
    return {
        targetId: baseline.targetId,
        targetKind: baseline.targetKind,
        baseline: baselineMeasurements,
        preview: previewMeasurements,
        deltas: compareAgentScopeMeasurements({ baseline: baselineMeasurements, preview: previewMeasurements }),
        audition: {
            baseline: auditionRender(baseline),
            preview: auditionRender(preview),
            baselineIntegratedLoudness: baselineAll.integratedLoudness ?? unavailable,
            previewIntegratedLoudness: previewAll.integratedLoudness ?? unavailable,
        },
    };
}
