import { type MeasuredPreview } from '../models/MeasuredPreview';

import { digestCommandBatchContent } from './digestCommandBatchContent';

/**
 * The measured preview an approval of `envelope` may show: the figures only when `envelope` is the
 * exact batch the preview rendered, anchored at the revision whose mix the baseline rendered,
 * otherwise none. A batch that gained, lost or changed a command since measurement describes a
 * change nobody measured, and a batch re-anchored to a later revision would set the old mix's
 * figures beside a project that has moved.
 */
export function bindMeasuredPreviewToBatch(
    measuredPreview: MeasuredPreview | undefined,
    envelope: Parameters<typeof digestCommandBatchContent>[0]
): MeasuredPreview | undefined {
    if (
        measuredPreview === undefined ||
        measuredPreview.revision !== envelope.baseRevision ||
        measuredPreview.batchContentHash !== digestCommandBatchContent(envelope)
    ) {
        return undefined;
    }
    return measuredPreview;
}
