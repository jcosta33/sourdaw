import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeAddTrack } from './trackHandlers';

describe('trackHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeAddTrack forwards payload to addTrack', () => {
        const addTrack = vi.fn();
        injectDependencies(executeAddTrack, { addTrack });

        executeAddTrack({
            type: 'addTrack',
            payload: { name: 'Drums', kind: 'audio' },
        });

        expect(addTrack).toHaveBeenCalledWith({ name: 'Drums', kind: 'audio' });
    });
});
