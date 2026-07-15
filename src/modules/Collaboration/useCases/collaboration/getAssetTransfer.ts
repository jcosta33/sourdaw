import { type AssetTransfer } from '../assetTransfer';

import { collaborationSessionRuntime } from './sessionManagement';

export function getAssetTransfer(): AssetTransfer | null {
    return collaborationSessionRuntime.getAssetTransfer();
}
