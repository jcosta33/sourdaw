import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getVcaGroups } from './getVcaGroups';

describe('getVcaGroups', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns a copy of the groups from the injected getter', () => {
        const g1 = { id: 'v1', name: 'A', gain: 1, muted: false, trackIds: [] };
        injectDependencies(getVcaGroups, {
            getVcaGroupsState: () => [g1],
        });

        const out = getVcaGroups();
        expect(out).toEqual([g1]);
        out.pop();
        expect(getVcaGroups()).toHaveLength(1);
    });
});
