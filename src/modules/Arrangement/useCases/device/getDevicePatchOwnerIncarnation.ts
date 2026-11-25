import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';

import { readRawDevicePatchOwner } from './readRawDevicePatchOwner';

export function getDevicePatchOwnerIncarnation(target: Parameters<typeof readRawDevicePatchOwner>[1]) {
    const root = getCrdtDoc<Readonly<Record<string, unknown>>>('root');
    const owner = root ? readRawDevicePatchOwner(root, target) : null;
    return owner?.deviceObjectId ? { trackObjectId: owner.trackObjectId, deviceObjectId: owner.deviceObjectId } : null;
}
