import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { type ShowDevicePanelGenericPayload } from '../../../events/WorkspaceEvents';
import { onShowDevicePanel } from '../devicePanels/onShowDevicePanel';
import { showDevicePanel } from '../devicePanels/showDevicePanel';
import { showDevicePanelForType } from '../devicePanels/showDevicePanelForType';

const mocks = vi.hoisted(() => ({
    mockEventBus: {
        emit: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
    },
}));

describe('devicePanels', () => {
    beforeEach(() => {
        injectDependencies(showDevicePanel, { eventBus: mocks.mockEventBus });
        injectDependencies(showDevicePanelForType, { eventBus: mocks.mockEventBus });
        vi.clearAllMocks();
    });

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

    it('should emit panel.showDevice for known device types', () => {
        showDevicePanelForType('fermenter', 'd1');

        expect(mocks.mockEventBus.emit).toHaveBeenCalledWith('panel.showDevice', {
            deviceType: 'fermenter',
            deviceId: 'd1',
        });
    });

    it('should emit exactly one event for a known device type — no per-device twin', () => {
        showDevicePanelForType('fermenter', 'd1');

        expect(mocks.mockEventBus.emit).toHaveBeenCalledTimes(1);
        expect(mocks.mockEventBus.emit).toHaveBeenLastCalledWith('panel.showDevice', {
            deviceType: 'fermenter',
            deviceId: 'd1',
        });
    });

    it('should not emit when device type is unknown', () => {
        showDevicePanelForType('unknown-panel', 'd1');

        expect(mocks.mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should subscribe to panel.showDevice', () => {
        const unsubscribe = vi.fn();
        mocks.mockEventBus.on.mockReturnValue(unsubscribe);

        const handler = vi.fn() as (payload: ShowDevicePanelGenericPayload) => void;
        expect(onShowDevicePanel(handler)).toBe(unsubscribe);
        expect(mocks.mockEventBus.on).toHaveBeenCalledWith('panel.showDevice', handler);
    });
});
