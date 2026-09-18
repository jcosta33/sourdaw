import { resetCrustMeters } from '../stores/crustStore';

/**
 * Reset one Crust instance's held meter readings. The device id scopes the
 * reset to the panel that pressed it — resetting a shared slot cleared every
 * running instance's readouts (#3672).
 */
export function resetCrustPanelMeters(deviceId: string): void {
    resetCrustMeters(deviceId);
}
