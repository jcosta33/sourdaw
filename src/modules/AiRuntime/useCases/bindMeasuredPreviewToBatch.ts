import { type MeasuredPreview } from '../models/MeasuredPreview';

import { digestCommandBatchContent } from './digestCommandBatchContent';

/**
 * The measured preview an approval of `envelope` may show: the figures only when `envelope` is the
 * exact batch the preview rendered, otherwise none. A batch that gained, lost or changed a command
 * since measurement describes a change nobody measured.
 */
export function bindMeasuredPreviewToBatch(
    measuredPreview: MeasuredPreview | undefined,
    envelope: Parameters<typeof digestCommandBatchContent>[0]
): MeasuredPreview | undefined {
    if (measuredPreview === undefined || measuredPreview.batchContentHash !== digestCommandBatchContent(envelope)) {
        return undefined;
    }
    return measuredPreview;
}
