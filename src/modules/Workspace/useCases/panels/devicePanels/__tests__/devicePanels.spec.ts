import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
}));

vi.mock('#/infra/di/inject', () => ({
    inject: (deps: Record<string, unknown>) => (factory: (d: Record<string, unknown>) => unknown) =>
        factory(Object.fromEntries(Object.entries(deps).map(([k]) => [k, mocks]))),
}));

vi.mock('../../../workspaceEventBus', () => ({
    WorkspaceEventBus: { emit: mocks.emit, on: mocks.on },
}));

import { onPanelShowBacteria } from '../onPanelShowBacteria';
import { onPanelShowFermenter } from '../onPanelShowFermenter';
import { onPanelShowGluten } from '../onPanelShowGluten';
import { showBacteriaPanel } from '../showBacteriaPanel';
import { showCrumbsPanel } from '../showCrumbsPanel';
import { showDevicePanel } from '../showDevicePanel';
import { showFermenterPanel } from '../showFermenterPanel';
import { showGlutenPanel } from '../showGlutenPanel';
import { showLevainPanel } from '../showLevainPanel';
import { showProofPanel } from '../showProofPanel';
import { showToasterPanel } from '../showToasterPanel';

describe('device panel functions', () => {
    beforeEach(() => vi.clearAllMocks());

    it('showDevicePanel emits with type and id', () => {
        showDevicePanel('fermenter', 'device-1');
        expect(mocks.emit).toHaveBeenCalledWith('panel.showDevice', { deviceType: 'fermenter', deviceId: 'device-1' });
    });

    it('showDevicePanel accepts null deviceId', () => {
        showDevicePanel('gluten', null);
        expect(mocks.emit).toHaveBeenCalledWith('panel.showDevice', { deviceType: 'gluten', deviceId: null });
    });

    it('showFermenterPanel emits with deviceId', () => {
        showFermenterPanel('dev-1');
        expect(mocks.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ deviceId: 'dev-1' }));
    });

    it('showGlutenPanel emits with deviceId', () => {
        showGlutenPanel('dev-2');
        expect(mocks.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ deviceId: 'dev-2' }));
    });

    it('showBacteriaPanel emits with deviceId', () => {
        showBacteriaPanel('dev-3');
        expect(mocks.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ deviceId: 'dev-3' }));
    });

    it('showToasterPanel emits with deviceId', () => {
        showToasterPanel('dev-4');
        expect(mocks.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ deviceId: 'dev-4' }));
    });

    it('showLevainPanel emits with deviceId', () => {
        showLevainPanel('dev-5');
        expect(mocks.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ deviceId: 'dev-5' }));
    });

    it('showProofPanel emits with deviceId', () => {
        showProofPanel('dev-6');
        expect(mocks.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ deviceId: 'dev-6' }));
    });

    it('showCrumbsPanel emits with deviceId', () => {
        showCrumbsPanel('dev-7');
        expect(mocks.emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ deviceId: 'dev-7' }));
    });

    it('onPanelShowFermenter subscribes handler', () => {
        const handler = vi.fn();
        const unsub = onPanelShowFermenter(handler);
        expect(mocks.on).toHaveBeenCalledWith(expect.any(String), handler);
        expect(typeof unsub).toBe('function');
    });

    it('onPanelShowGluten subscribes handler', () => {
        onPanelShowGluten(vi.fn());
        expect(mocks.on).toHaveBeenCalled();
    });

    it('onPanelShowBacteria subscribes handler', () => {
        onPanelShowBacteria(vi.fn());
        expect(mocks.on).toHaveBeenCalled();
    });
});
