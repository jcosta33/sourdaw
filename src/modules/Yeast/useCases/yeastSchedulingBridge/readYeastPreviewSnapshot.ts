import { yeastPreviewTap } from '../../engine/yeastPreviewTap';

import type { YeastPreviewSnapshot } from '../../models/YeastPreviewSnapshot';

type ReadYeastPreviewSnapshotInput = {
    rackId: string;
    routeId?: string;
    trackId: string;
};

export function readYeastPreviewSnapshot({
    rackId,
    trackId,
    routeId = trackId,
}: ReadYeastPreviewSnapshotInput): YeastPreviewSnapshot {
    return yeastPreviewTap.read({ rackId, routeId, trackId });
}
