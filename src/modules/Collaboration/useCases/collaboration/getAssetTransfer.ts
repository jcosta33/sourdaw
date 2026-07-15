import { type AssetTransfer } from '../assetTransfer';

import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export function getAssetTransfer(): AssetTransfer | null {
    return runtime.state.assetTransfer;
}
