import { setMpeEnabledInternal } from '../state';

export function setMpeEnabled(enabled: boolean): void {
    setMpeEnabledInternal(enabled);
}
