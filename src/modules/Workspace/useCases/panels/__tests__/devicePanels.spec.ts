import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showFermenterPanel } from '../devicePanels/showFermenterPanel';
import { showToasterPanel } from '../devicePanels/showToasterPanel';
import { showLevainPanel } from '../devicePanels/showLevainPanel';
import { showDutchOvenPanel } from '../devicePanels/showDutchOvenPanel';
import { showGlutenPanel } from '../devicePanels/showGlutenPanel';
import { showBacteriaPanel } from '../devicePanels/showBacteriaPanel';
import { showGrinderPanel } from '../devicePanels/showGrinderPanel';
import { showProofPanel } from '../devicePanels/showProofPanel';
import { showYeastPanel } from '../devicePanels/showYeastPanel';
import { showScoringPanel } from '../devicePanels/showScoringPanel';
import { showCrustPanel } from '../devicePanels/showCrustPanel';
import { showCrumbsPanel } from '../devicePanels/showCrumbsPanel';
import { showGrandBoulePanel } from '../devicePanels/showGrandBoulePanel';
import { showAutomationPanel } from '../devicePanels/showAutomationPanel';
import { showDevicePanelForType } from '../devicePanels/showDevicePanelForType';
import { onPanelShowFermenter } from '../devicePanels/onPanelShowFermenter';
import { onPanelShowToaster } from '../devicePanels/onPanelShowToaster';
import { onPanelShowLevain } from '../devicePanels/onPanelShowLevain';
import { onPanelShowDutchOven } from '../devicePanels/onPanelShowDutchOven';
import { onPanelShowGluten } from '../devicePanels/onPanelShowGluten';
import { onPanelShowBacteria } from '../devicePanels/onPanelShowBacteria';
import { onPanelShowGrinder } from '../devicePanels/onPanelShowGrinder';
import { onPanelShowProof } from '../devicePanels/onPanelShowProof';
import { onPanelShowYeast } from '../devicePanels/onPanelShowYeast';
import { onPanelShowScoring } from '../devicePanels/onPanelShowScoring';
import { onPanelShowCrust } from '../devicePanels/onPanelShowCrust';
import { onPanelShowCrumbs } from '../devicePanels/onPanelShowCrumbs';
import { onPanelShowGrandBoule } from '../devicePanels/onPanelShowGrandBoule';
import { onPanelShowAutomation } from '../devicePanels/onPanelShowAutomation';
import { type ShowDevicePanelPayload } from '../../../events/WorkspaceEvents';

const mocks = vi.hoisted(() => ({ mockEventBus: {
        emit: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
    } }));

vi.mock('#/app/registerDependencies', () => ({
    eventBus: mocks.mockEventBus,
}));

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
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each(showPanelCases)('should emit $event when opening the $label panel', ({ show, event }) => {
        show('dev-1');

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith(event, { deviceId: 'dev-1' });
    });

    it('should emit panel.showAutomation without payload', () => {
        showAutomationPanel();

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith('panel.showAutomation', undefined);
    });

    it('should emit mapped panel event for known device types', () => {
        showDevicePanelForType('fermenter', 'd1');

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith('panel.showFermenter', { deviceId: 'd1' });
    });

    it('should not emit when device type is unknown', () => {
        showDevicePanelForType('unknown-panel', 'd1');

        expect(mocks.mockEventBus.emit).not.toHaveBeenCalled();
    });

    it.each(onPanelCases)('should subscribe to $event for the $label panel', ({ onPanel, event }) => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        expect(onPanel(handler)).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith(event, handler);
    });

    it('should subscribe to panel.showAutomation', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn();
        expect(onPanelShowAutomation(handler)).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('panel.showAutomation', handler);
    });
});
