import { describe, it, expect, vi } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { restoreSnapshot } from '../snapshotHelpers/restoreSnapshot';
import { type Logger } from '#/helpers/Logger/Logger';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { set: vi.fn(), value: null },
}));
vi.mock('#/modules/Arrangement/stores/markerStore', () => ({
    markerStore: { set: vi.fn(), value: null },
}));
vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { set: vi.fn(), value: null },
}));

describe('restoreSnapshot', () => {
    it('should parse snapshot data into stores', () => {
        const logger = createMock<Logger>();
        injectDependencies(restoreSnapshot, { logger });

        const payload = {
            tracks: { tracks: [], selectedTrackId: null },
            markers: [],
            transport: { playheadPosition: 0 },
        };

        restoreSnapshot({
            data: JSON.stringify(payload),
            size: 10,
        });

        expect(trackStore.set).toHaveBeenCalledWith(payload.tracks);
        expect(markerStore.set).toHaveBeenCalledWith(payload.markers);
        expect(transportStore.set).toHaveBeenCalledWith(payload.transport);
    });

    it('should log when snapshot JSON is corrupt', () => {
        const logger = createMock<Logger>();
        injectDependencies(restoreSnapshot, { logger });

        restoreSnapshot({ data: '{not json', size: 1 });

        expect(logger.error).toHaveBeenCalledWith(expect.any(Error));
    });
});
