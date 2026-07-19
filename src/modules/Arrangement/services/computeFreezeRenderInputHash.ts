import { type Clip, type Device } from '../models/Track';

import { computeTrackHash } from './computeTrackHash';

export async function computeFreezeRenderInputHash(
    clips: readonly Clip[],
    devices: readonly Device[],
    adjustmentLayerSignature: string
): Promise<string> {
    return `freeze-v2:${await computeTrackHash(clips, devices, adjustmentLayerSignature)}`;
}
