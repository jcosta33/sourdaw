import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { getCollaborationStoreValue } from '../collaborationQueries';
import { collaborationStore } from '../../stores/collaborationStore';

vi.mock('../../stores/collaborationStore', () => ({
    collaborationStore: { value: null },
}));

describe('getCollaborationStoreValue', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns the injected store snapshot', () => {
        const snapshot = { isEnabled: false };
        (collaborationStore as any).value = snapshot;

        expect(getCollaborationStoreValue()).toBe(snapshot);
    });
});
