import { getMpeEnabledInternal } from '../state';

export function getMpeEnabled(): boolean {
    return getMpeEnabledInternal();
}