import { describe, it, expect, vi, beforeEach } from 'vitest';

import { markerStore } from '../../stores/markerStore';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { trackStore } from '../../stores/trackStore';
import { vcaGroupStore } from '../../stores/vcaGroupStore';
import { resetArrangementStoresForProject } from '../resetArrangementStoresForProject';

vi.mock('../../stores/trackStore', () => ({
    trackStore: { set: vi.fn() },
}));

vi.mock('../../stores/markerStore', () => ({
    markerStore: { set: vi.fn() },
}));

vi.mock('../../stores/takeLaneStore', () => ({
    takeLaneStore: { set: vi.fn() },
}));

vi.mock('../../stores/vcaGroupStore', () => ({
    vcaGroupStore: { set: vi.fn() },
}));

describe('resetArrangementStoresForProject', () => {
    beforeEach(() => {
        vi.mocked(trackStore.set).mockClear();
        vi.mocked(markerStore.set).mockClear();
        vi.mocked(takeLaneStore.set).mockClear();
        vi.mocked(vcaGroupStore.set).mockClear();
    });

    it('should reset Arrangement-owned stores for a new project', () => {
        resetArrangementStoresForProject();

        expect(trackStore.set).toHaveBeenCalledWith({ tracks: [], selectedTrackId: null });
        expect(markerStore.set).toHaveBeenCalledWith({ markers: [], sections: [] });
        expect(takeLaneStore.set).toHaveBeenCalledWith({ lanes: [] });
        expect(vcaGroupStore.set).toHaveBeenCalledWith({ groups: [] });
    });
});
