import { selectDevice } from '#/modules/Arrangement/useCases';

import { openInspector } from '../togglePanel/panelToggles/openInspector';

/**
 * Shows a device in the inspector: selects it, then opens the panel so the
 * detail view is on screen. The inspector resolves the id against the selected
 * track, so a device on another track still lands on that track's view.
 */
export function revealDeviceInInspector(deviceId: string): void {
    selectDevice(deviceId);
    openInspector();
}
