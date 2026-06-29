import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { zoomToFit } from '../zoomToFit';
import { zoomToSelection } from '../zoomToSelection';

const mocks = vi.hoisted(() => ({
    eventBus: { emit: vi.fn() },
    getWorkspaceState: vi.fn(),
    trackStoreValue: {
        value: null as { tracks: { clips: { id: string; startBeat: number; endBeat: number }[] }[] } | null,
    },
}));

vi.mock('../../../../repositories/getWorkspaceState', () => ({
    getWorkspaceState: mocks.getWorkspaceState,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

describe('Zoom Operations', () => {
    beforeEach(() => {
        injectDependencies(zoomToFit, { eventBus: mocks.eventBus });
        vi.clearAllMocks();
    });

    describe('zoomToFit', () => {
        it('emits zoom.toFit event', () => {
            zoomToFit();
            expect(mocks.eventBus.emit).toHaveBeenCalledWith('zoom.toFit', undefined);
        });
    });

    describe('zoomToSelection', () => {
        it('bails if no selection', () => {
            mocks.getWorkspaceState.mockReturnValue({ selectedClipIds: [], selectedClipId: null });
            mocks.trackStoreValue.value = { tracks: [] };

            zoomToSelection();

            expect(mocks.eventBus.emit).not.toHaveBeenCalled();
        });

        it('calculates bounds of selected clips and emits zoom.toSelection', () => {
            mocks.getWorkspaceState.mockReturnValue({ selectedClipIds: ['c1', 'c3'], selectedClipId: null });
            mocks.trackStoreValue.value = {
                tracks: [
                    {
                        clips: [
                            { id: 'c1', startBeat: 4, endBeat: 8 },
                            { id: 'c2', startBeat: 10, endBeat: 12 },
                        ],
                    },
                    { clips: [{ id: 'c3', startBeat: 2, endBeat: 6 }] },
                ],
            };

            zoomToSelection();

            // min start = 2 (c3), max end = 8 (c1)
            expect(mocks.eventBus.emit).toHaveBeenCalledWith('zoom.toSelection', {
                startBeat: 2,
                endBeat: 8,
            });
        });

        it('uses single selectedClipId if selectedClipIds is empty', () => {
            mocks.getWorkspaceState.mockReturnValue({ selectedClipIds: [], selectedClipId: 'c1' });
            mocks.trackStoreValue.value = {
                tracks: [{ clips: [{ id: 'c1', startBeat: 10, endBeat: 20 }] }],
            };

            zoomToSelection();

            expect(mocks.eventBus.emit).toHaveBeenCalledWith('zoom.toSelection', {
                startBeat: 10,
                endBeat: 20,
            });
        });
    });
});
