import { yeastPreviewTap } from '../../engine/yeastPreviewTap';

import type { YeastPreviewSnapshot } from '../../models/YeastPreviewSnapshot';

export function readYeastPreviewSnapshot(): YeastPreviewSnapshot {
    return yeastPreviewTap.read();
}
