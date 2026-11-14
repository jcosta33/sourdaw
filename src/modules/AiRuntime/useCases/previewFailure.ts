import { type PreviewMeasurementFailure } from './previewRefusalFailure';

export function previewFailure(
    status: 'no-op' | 'rejected' | 'conflicted' | 'failed',
    reason: string | undefined
): PreviewMeasurementFailure {
    if (status === 'no-op') {
        return {
            code: 'preview-unavailable',
            safeMessage: 'The proposal changes nothing to measure.',
            retryable: true,
        };
    }
    return {
        code: 'preview-unavailable',
        safeMessage: `The proposal could not be previewed: ${reason ?? status}`,
        retryable: true,
    };
}
