import { yeastPreviewTap } from '../../engine/yeastPreviewTap';
import { YEAST_PREVIEW_RACK_ID } from '../../models/YeastPreviewSnapshot';

import type { YeastPreviewSnapshot } from '../../models/YeastPreviewSnapshot';

type ReadYeastPreviewSnapshotInput = {
    trackId: string;
};

export function readYeastPreviewSnapshot({ trackId }: ReadYeastPreviewSnapshotInput): YeastPreviewSnapshot {
    return yeastPreviewTap.read({ rackId: YEAST_PREVIEW_RACK_ID, routeId: trackId, trackId });
}
