import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type ShowDevicePanelPayload, type ShowDevicePanelGenericPayload } from '../../../events/WorkspaceEvents';
import { onPanelShowAutomation } from '../devicePanels/onPanelShowAutomation';
import { onPanelShowBacteria } from '../devicePanels/onPanelShowBacteria';
import { onPanelShowCrumbs } from '../devicePanels/onPanelShowCrumbs';
import { onPanelShowCrust } from '../devicePanels/onPanelShowCrust';
import { onPanelShowDutchOven } from '../devicePanels/onPanelShowDutchOven';
import { onPanelShowFermenter } from '../devicePanels/onPanelShowFermenter';
import { onPanelShowGluten } from '../devicePanels/onPanelShowGluten';
import { onPanelShowGrandBoule } from '../devicePanels/onPanelShowGrandBoule';
import { onPanelShowLevain } from '../devicePanels/onPanelShowLevain';
import { onPanelShowProof } from '../devicePanels/onPanelShowProof';
import { onPanelShowScoring } from '../devicePanels/onPanelShowScoring';
import { onPanelShowToaster } from '../devicePanels/onPanelShowToaster';
import { onPanelShowYeast } from '../devicePanels/onPanelShowYeast';
import { onShowDevicePanel } from '../devicePanels/onShowDevicePanel';
import { showAutomationPanel } from '../devicePanels/showAutomationPanel';
import { showBacteriaPanel } from '../devicePanels/showBacteriaPanel';
import { showCrumbsPanel } from '../devicePanels/showCrumbsPanel';
import { showCrustPanel } from '../devicePanels/showCrustPanel';
import { showDevicePanel } from '../devicePanels/showDevicePanel';
import { showDevicePanelForType } from '../devicePanels/showDevicePanelForType';
import { showDutchOvenPanel } from '../devicePanels/showDutchOvenPanel';
import { showFermenterPanel } from '../devicePanels/showFermenterPanel';
import { showGlutenPanel } from '../devicePanels/showGlutenPanel';
import { showGrandBoulePanel } from '../devicePanels/showGrandBoulePanel';
import { showLevainPanel } from '../devicePanels/showLevainPanel';
import { showProofPanel } from '../devicePanels/showProofPanel';
import { showScoringPanel } from '../devicePanels/showScoringPanel';
import { showToasterPanel } from '../devicePanels/showToasterPanel';
import { showYeastPanel } from '../devicePanels/showYeastPanel';

const mocks = vi.hoisted(() => ({
    mockEventBus: {
        emit: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
    },
}));

const showPanelCases: Array<{ label: string; show: (deviceId: string | null) => void; event: string }> = [
    { label: 'fermenter', show: showFermenterPanel, event: 'panel.showFermenter' },
    { label: 'toaster', show: showToasterPanel, event: 'panel.showToaster' },
    { label: 'levain', show: showLevainPanel, event: 'panel.showLevain' },
    { label: 'dutch oven', show: showDutchOvenPanel, event: 'panel.showDutchOven' },
    { label: 'gluten', show: showGlutenPanel, event: 'panel.showGluten' },
    { label: 'bacteria', show: showBacteriaPanel, event: 'panel.showBacteria' },
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
    { label: 'proof', onPanel: onPanelShowProof, event: 'panel.showProof' },
    { label: 'yeast', onPanel: onPanelShowYeast, event: 'panel.showYeast' },
    { label: 'scoring', onPanel: onPanelShowScoring, event: 'panel.showScoring' },
    { label: 'crust', onPanel: onPanelShowCrust, event: 'panel.showCrust' },
    { label: 'crumbs', onPanel: onPanelShowCrumbs, event: 'panel.showCrumbs' },
    { label: 'grand boule', onPanel: onPanelShowGrandBoule, event: 'panel.showGrandBoule' },
];

describe('devicePanels', () => {
    beforeEach(() => {
        injectDependencies(showDevicePanel, { eventBus: mocks.mockEventBus });
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

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith('panel.showDevice', {
            deviceType: 'fermenter',
            deviceId: 'd1',
        });
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

    // ── Generic pair ─────────────────────────────────────────────────────────

    it('should emit panel.showDevice with deviceType and deviceId', () => {
        showDevicePanel('fermenter', 'dev-1');

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith('panel.showDevice', {
            deviceType: 'fermenter',
            deviceId: 'dev-1',
        });
    });

    it('should emit panel.showDevice with null deviceId', () => {
        showDevicePanel('automation', null);

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith('panel.showDevice', {
            deviceType: 'automation',
            deviceId: null,
        });
    });

    it('should subscribe to panel.showDevice', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn() as (payload: ShowDevicePanelGenericPayload) => void;
        expect(onShowDevicePanel(handler)).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('panel.showDevice', handler);
    });
});
