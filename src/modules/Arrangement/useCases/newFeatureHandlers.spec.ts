import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeSwitchMonitorNewFeature } from './newFeatureHandlers';

describe('newFeatureHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeSwitchMonitorNewFeature forwards monitor id', async () => {
        const switchMonitor = vi.fn();
        injectDependencies(executeSwitchMonitorNewFeature, { switchMonitor });

        await executeSwitchMonitorNewFeature({ payload: { monitorId: 'm1' } });

        expect(switchMonitor).toHaveBeenCalledWith('m1');
    });
});
