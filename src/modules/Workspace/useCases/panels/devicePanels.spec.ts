import { describe, it, expect, vi } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import {
    showFermenterPanel,
    showToasterPanel,
    showLevainPanel,
    showDutchOvenPanel,
    showGlutenPanel,
    showBacteriaPanel,
    showGrinderPanel,
    showProofPanel,
    showYeastPanel,
    showScoringPanel,
    showCrustPanel,
    showCrumbsPanel,
    showGrandBoulePanel,
    showAutomationPanel,
    showDevicePanelForType,
    onPanelShowFermenter,
    onPanelShowToaster,
    onPanelShowLevain,
    onPanelShowDutchOven,
    onPanelShowGluten,
    onPanelShowBacteria,
    onPanelShowGrinder,
    onPanelShowProof,
    onPanelShowYeast,
    onPanelShowScoring,
    onPanelShowCrust,
    onPanelShowCrumbs,
    onPanelShowGrandBoule,
    onPanelShowAutomation,
} from './devicePanels';
import { type ShowDevicePanelPayload } from '#/modules/Workspace/events/WorkspaceEvents';

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
};

const showPanelCases: Array<{ label: string; show: (deviceId: string | null) => void; event: string }> = [
    { label: 'fermenter', show: showFermenterPanel, event: 'panel.showFermenter' },
    { label: 'toaster', show: showToasterPanel, event: 'panel.showToaster' },
    { label: 'levain', show: showLevainPanel, event: 'panel.showLevain' },
    { label: 'dutch oven', show: showDutchOvenPanel, event: 'panel.showDutchOven' },
    { label: 'gluten', show: showGlutenPanel, event: 'panel.showGluten' },
    { label: 'bacteria', show: showBacteriaPanel, event: 'panel.showBacteria' },
    { label: 'grinder', show: showGrinderPanel, event: 'panel.showGrinder' },
    { label: 'proof', show: showProofPanel, event: 'panel.showProof' },
    { label: 'yeast', show: showYeastPanel, event: 'panel.showYeast' },
    { label: 'scoring', show: showScoringPanel, event: 'panel.showScoring' },
    { label: 'crust', show: showCrustPanel, event: 'panel.showCrust' },
    { label: 'crumbs', show: showCrumbsPanel, event: 'panel.showCrumbs' },
    { label: 'grand boule', show: showGrandBoulePanel, event: 'panel.showGrandBoule' },
];

const onPanelCases: Array<{
    label: string;
    onPanel: (handler: (payload: ShowDevicePanelPayload) => void) => () => void;
    event: string;
}> = [
    { label: 'fermenter', onPanel: onPanelShowFermenter, event: 'panel.showFermenter' },
    { label: 'toaster', onPanel: onPanelShowToaster, event: 'panel.showToaster' },
    { label: 'levain', onPanel: onPanelShowLevain, event: 'panel.showLevain' },
    { label: 'dutch oven', onPanel: onPanelShowDutchOven, event: 'panel.showDutchOven' },
    { label: 'gluten', onPanel: onPanelShowGluten, event: 'panel.showGluten' },
    { label: 'bacteria', onPanel: onPanelShowBacteria, event: 'panel.showBacteria' },
    { label: 'grinder', onPanel: onPanelShowGrinder, event: 'panel.showGrinder' },
    { label: 'proof', onPanel: onPanelShowProof, event: 'panel.showProof' },
    { label: 'yeast', onPanel: onPanelShowYeast, event: 'panel.showYeast' },
    { label: 'scoring', onPanel: onPanelShowScoring, event: 'panel.showScoring' },
    { label: 'crust', onPanel: onPanelShowCrust, event: 'panel.showCrust' },
    { label: 'crumbs', onPanel: onPanelShowCrumbs, event: 'panel.showCrumbs' },
    { label: 'grand boule', onPanel: onPanelShowGrandBoule, event: 'panel.showGrandBoule' },
];

describe('devicePanels', () => {
    it.each(showPanelCases)('should emit $event when opening the $label panel', ({ show, event }) => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(show, { eventBus });

        show('dev-1');

        expect(eventBus.emit).toHaveBeenCalledWith(event, { deviceId: 'dev-1' });
    });

    it('should emit panel.showAutomation without payload', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(showAutomationPanel, { eventBus });

        showAutomationPanel();

        expect(eventBus.emit).toHaveBeenCalledWith('panel.showAutomation', undefined);
    });

    it('should emit mapped panel event for known device types', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(showDevicePanelForType, { eventBus });

        showDevicePanelForType('fermenter', 'd1');

        expect(eventBus.emit).toHaveBeenCalledWith('panel.showFermenter', { deviceId: 'd1' });
    });

    it('should not emit when device type is unknown', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(showDevicePanelForType, { eventBus });

        showDevicePanelForType('unknown-panel', 'd1');

        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it.each(onPanelCases)('should subscribe to $event for the $label panel', ({ onPanel, event }) => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onPanel, { eventBus });

        const handler = vi.fn();
        expect(onPanel(handler)).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith(event, handler);
    });

    it('should subscribe to panel.showAutomation', () => {
        const eventBus = createMock<EventBusShape>();
        const unsubscribe = vi.fn();
        eventBus.on.mockReturnValue(unsubscribe);
        injectDependencies(onPanelShowAutomation, { eventBus });

        const handler = vi.fn();
        expect(onPanelShowAutomation(handler)).toBe(unsubscribe);
        expect(eventBus.on).toHaveBeenCalledWith('panel.showAutomation', handler);
    });
});
