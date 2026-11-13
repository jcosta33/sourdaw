import { type renderAgentPreviewMeasurementScope } from '#/modules/AudioRendering/useCases';

import { readAgentResourceLimits } from '../stores/agentResourceLimitsStore';

type PreviewRender = Awaited<ReturnType<typeof renderAgentPreviewMeasurementScope>>;
type PreviewRefusal = Pick<Extract<PreviewRender, { status: 'refused' }>, 'code' | 'subject' | 'targetId' | 'deviceId'>;
/** A preview measurement's failure as its receipt reports it. */
export type PreviewMeasurementFailure = { code: string; safeMessage: string; retryable: boolean };

export function previewRefusalFailure(refusal: PreviewRefusal): PreviewMeasurementFailure {
    const { measurementMeasuredSeconds, measurementRenderedSeconds } = readAgentResourceLimits();
    const target = refusal.targetId ?? 'master';
    const device = refusal.deviceId ?? 'unknown';
    const document = refusal.subject === 'preview' ? 'the preview' : 'the project';
    const failures: Readonly<Record<PreviewRefusal['code'], Omit<PreviewMeasurementFailure, 'code'>>> = {
        'unknown-target': { safeMessage: `Target ${target} is not in ${document}.`, retryable: true },
        'kind-mismatch': { safeMessage: `Target ${target} is not of the kind this scope names.`, retryable: true },
        'muted-contributor': {
            safeMessage: `Target ${target} cannot be measured in isolation: a muted contributor would be rendered unmuted.`,
            retryable: false,
        },
        'disabled-contributor': {
            safeMessage: `Target ${target} cannot be measured in isolation: a disabled contributor builds no live strip.`,
            retryable: false,
        },
        'render-busy': { safeMessage: 'Another offline render is in progress.', retryable: true },
        'stale-revision': {
            safeMessage: 'The project changed while the preview was being measured; read it again before measuring.',
            retryable: true,
        },
        'empty-render': { safeMessage: `The render of ${target} in ${document} holds no audio.`, retryable: false },
        'render-failed': { safeMessage: `The render of ${target} in ${document} failed.`, retryable: false },
        'range-exceeds-ceiling': {
            safeMessage: `In ${document}, a measurement covers at most ${String(measurementMeasuredSeconds)} s and ends within ${String(measurementRenderedSeconds)} s of the project start.`,
            retryable: true,
        },
        'unprojectable-device-state': {
            safeMessage: `The preview cannot be rendered from its own data: device ${device} holds state the render would read from the live project.`,
            retryable: false,
        },
        'unrenderable-preview-device': {
            safeMessage: `The preview cannot be rendered: device ${device} has no loaded instance to render.`,
            retryable: false,
        },
    };
    return { code: refusal.code, ...failures[refusal.code] };
}
