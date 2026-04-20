import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Container } from '#/infra/di/Container';

import { collaborationStore } from '../../stores/collaborationStore';
import { getCollaborationStoreValue } from '../collaborationQueries';

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
