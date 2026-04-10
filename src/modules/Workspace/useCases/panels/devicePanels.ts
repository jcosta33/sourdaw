/**
 * Use cases for opening device panels and subscribing to panel-open events.
 *
 * Views must not import eventBus directly — they call these use cases instead.
 */

import { inject } from '#/infra/di/inject';
import { eventBus } from '#/app/registerDependencies';
import { type ShowDevicePanelPayload } from '../../events/WorkspaceEvents';

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

// ── Emitters ──────────────────────────────────────────────────────────────────

export const showFermenterPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showFermenterPanel(deviceId: string | null): void {
            eventBus.emit('panel.showFermenter', { deviceId });
        }
);

export const showToasterPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showToasterPanel(deviceId: string | null): void {
            eventBus.emit('panel.showToaster', { deviceId });
        }
);

export const showLevainPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showLevainPanel(deviceId: string | null): void {
            eventBus.emit('panel.showLevain', { deviceId });
        }
);

export const showDutchOvenPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showDutchOvenPanel(deviceId: string | null): void {
            eventBus.emit('panel.showDutchOven', { deviceId });
        }
);

export const showGlutenPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showGlutenPanel(deviceId: string | null): void {
            eventBus.emit('panel.showGluten', { deviceId });
        }
);

export const showBacteriaPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showBacteriaPanel(deviceId: string | null): void {
            eventBus.emit('panel.showBacteria', { deviceId });
        }
);

export const showGrinderPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showGrinderPanel(deviceId: string | null): void {
            eventBus.emit('panel.showGrinder', { deviceId });
        }
);

export const showProofPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showProofPanel(deviceId: string | null): void {
            eventBus.emit('panel.showProof', { deviceId });
        }
);

export const showYeastPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showYeastPanel(deviceId: string | null): void {
            eventBus.emit('panel.showYeast', { deviceId });
        }
);

export const showScoringPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showScoringPanel(deviceId: string | null): void {
            eventBus.emit('panel.showScoring', { deviceId });
        }
);

export const showCrustPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showCrustPanel(deviceId: string | null): void {
            eventBus.emit('panel.showCrust', { deviceId });
        }
);

export const showCrumbsPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showCrumbsPanel(deviceId: string | null): void {
            eventBus.emit('panel.showCrumbs', { deviceId });
        }
);

export const showGrandBoulePanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showGrandBoulePanel(deviceId: string | null): void {
            eventBus.emit('panel.showGrandBoule', { deviceId });
        }
);

export const showAutomationPanel = inject({ eventBus })(
    ({ eventBus }) =>
        function showAutomationPanel(): void {
            eventBus.emit('panel.showAutomation', undefined);
        }
);

/** Generic dispatch — for cases where the panel event is determined at runtime by device type. */
export const showDevicePanelForType = inject({ eventBus })(
    ({ eventBus }) =>
        function showDevicePanelForType(deviceType: string, deviceId: string): void {
            const event = DEVICE_TYPE_TO_PANEL_EVENT[deviceType];
            if (event) {
                eventBus.emit(event, { deviceId });
            }
        }
);

// ── Subscribers ───────────────────────────────────────────────────────────────

export const onPanelShowFermenter = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowFermenter(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showFermenter', handler);
        }
);

export const onPanelShowToaster = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowToaster(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showToaster', handler);
        }
);

export const onPanelShowLevain = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowLevain(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showLevain', handler);
        }
);

export const onPanelShowDutchOven = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowDutchOven(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showDutchOven', handler);
        }
);

export const onPanelShowGluten = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowGluten(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showGluten', handler);
        }
);

export const onPanelShowBacteria = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowBacteria(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showBacteria', handler);
        }
);

export const onPanelShowGrinder = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowGrinder(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showGrinder', handler);
        }
);

export const onPanelShowProof = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowProof(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showProof', handler);
        }
);

export const onPanelShowYeast = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowYeast(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showYeast', handler);
        }
);

export const onPanelShowScoring = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowScoring(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showScoring', handler);
        }
);

export const onPanelShowCrust = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowCrust(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showCrust', handler);
        }
);

export const onPanelShowCrumbs = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowCrumbs(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showCrumbs', handler);
        }
);

export const onPanelShowGrandBoule = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowGrandBoule(handler: (payload: ShowDevicePanelPayload) => void): () => void {
            return eventBus.on('panel.showGrandBoule', handler);
        }
);

export const onPanelShowAutomation = inject({ eventBus })(
    ({ eventBus }) =>
        function onPanelShowAutomation(handler: () => void): () => void {
            return eventBus.on('panel.showAutomation', handler);
        }
);
