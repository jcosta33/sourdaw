import { setCrustUiLevel } from '../stores/crustStore';

/**
 * Set one Crust instance's UI disclosure level. The level is per-device patch
 * state: two Crust instances disclose independently (#3672).
 */
export function setCrustPanelUiLevel(deviceId: string, level: 1 | 2 | 3 | 4 | 5): void {
    setCrustUiLevel(deviceId, level);
}
