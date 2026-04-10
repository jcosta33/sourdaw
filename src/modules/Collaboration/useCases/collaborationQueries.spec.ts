import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getCollaborationStoreValue } from './collaborationQueries';

describe('getCollaborationStoreValue', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns the injected store snapshot', () => {
        const snapshot = { isEnabled: false };
        injectDependencies(getCollaborationStoreValue, {
            collaborationStore: { value: snapshot },
        });

        expect(getCollaborationStoreValue()).toBe(snapshot);
    });
});
