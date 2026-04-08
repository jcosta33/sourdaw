import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeAddDevice } from './deviceHandlers';

describe('deviceHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeAddDevice forwards track and device type', () => {
        const addDevice = vi.fn();
        injectDependencies(executeAddDevice, { addDevice });

        executeAddDevice({
            type: 'addDevice',
            payload: { trackId: 't1', deviceType: 'eq' },
        });

        expect(addDevice).toHaveBeenCalledWith('t1', 'eq');
    });
});
