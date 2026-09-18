import { inject } from '#/infra/di/inject';

import { WorkspaceEventBus } from '../../workspaceEventBus';

// ── Device types that own a panel (kept in the use-case layer) ────────────────

const PANELLED_DEVICE_TYPES: ReadonlySet<string> = new Set([
    'fermenter',
    'toaster',
    'levain',
    'dutch-oven',
    'gluten',
    'bacteria',
    'grinder',
    'proof',
    'yeast',
    'native-scoring',
    'crust',
    'builtin-crumbs',
    'grand-boule',
]);

/**
 * Generic dispatch — for cases where the panel event is determined at runtime by device type.
 *
 * Emits the single `panel.showDevice` event, carrying the device type, for every
 * device type that owns a panel; unknown types emit nothing.
 */
export const showDevicePanelForType = inject({ eventBus: WorkspaceEventBus })(
    ({ eventBus }) =>
        function showDevicePanelForType(deviceType: string, deviceId: string): void {
            if (!PANELLED_DEVICE_TYPES.has(deviceType)) {
                return;
            }

            void eventBus.emit('panel.showDevice', { deviceType, deviceId });
        }
);
