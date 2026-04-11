import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';

// ── Device-type → panel-event mapping (kept in the use-case layer) ────────────

type DevicePanelEvent =
    | 'panel.showFermenter'
    | 'panel.showToaster'
    | 'panel.showLevain'
    | 'panel.showDutchOven'
    | 'panel.showGluten'
    | 'panel.showBacteria'
    | 'panel.showGrinder'
    | 'panel.showProof'
    | 'panel.showYeast'
    | 'panel.showScoring'
    | 'panel.showCrust'
    | 'panel.showCrumbs'
    | 'panel.showGrandBoule';

const DEVICE_TYPE_TO_PANEL_EVENT: Partial<Record<string, DevicePanelEvent>> = {
    fermenter: 'panel.showFermenter',
    toaster: 'panel.showToaster',
    levain: 'panel.showLevain',
    'dutch-oven': 'panel.showDutchOven',
    gluten: 'panel.showGluten',
    bacteria: 'panel.showBacteria',
    grinder: 'panel.showGrinder',
    proof: 'panel.showProof',
    yeast: 'panel.showYeast',
    'native-scoring': 'panel.showScoring',
    crust: 'panel.showCrust',
    'builtin-crumbs': 'panel.showCrumbs',
    'grand-boule': 'panel.showGrandBoule',
};

/** Generic dispatch — for cases where the panel event is determined at runtime by device type. */
export const showDevicePanelForType = inject({ eventBus })(
    ({ eventBus }) =>
        (function showDevicePanelForType(deviceType: string, deviceId: string): void {
            const event = DEVICE_TYPE_TO_PANEL_EVENT[deviceType];
            if (event) {
                eventBus.emit(event, { deviceId });
            }
        })
);