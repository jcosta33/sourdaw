import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeCreateCollabSession } from './collaborationHandlers';

describe('collaborationHandlers injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeCreateCollabSession forwards name', () => {
        const createSession = vi.fn();
        injectDependencies(executeCreateCollabSession, { createSession });

        executeCreateCollabSession({ type: 'createCollabSession', payload: { name: 'Jam' } });

        expect(createSession).toHaveBeenCalledWith('Jam');
    });
});
