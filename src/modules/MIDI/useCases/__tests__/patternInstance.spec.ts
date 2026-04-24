import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';

import { getPatternInstances } from '../patternInstance/getPatternInstances';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        trackStore: { value: null },
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: mocks.trackStore,
}));

describe('getPatternInstances', () => {
    beforeEach(() => {
        Container.clear();
        mocks.trackStore.value = null;
    });

    it('returns an empty list when track state is unavailable', () => {
        mocks.trackStore.value = null;

        expect(getPatternInstances('parent')).toEqual([]);
    });
});
