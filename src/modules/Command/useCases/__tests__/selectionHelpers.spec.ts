import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getSelectedTrackId } from '../selectionHelpers/getSelectedTrackId';

const mocks = vi.hoisted(() => ({
    trackStore: { value: null as { selectedTrackId: string | null } | null },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: mocks.trackStore,
}));

describe('getSelectedTrackId', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null when track state is unavailable', async () => {
        mocks.trackStore.value = null;

        expect(getSelectedTrackId()).toBeNull();
    });
});
