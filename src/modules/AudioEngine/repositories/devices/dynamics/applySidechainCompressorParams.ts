import { type OfflineDeviceNode } from '../types';

import { applyCompressorParams } from './applyCompressorParams';

export function applySidechainCompressorParams(dn: OfflineDeviceNode, params: Record<string, number>): void {
    applyCompressorParams(dn, params, 'sc-comp');
}
