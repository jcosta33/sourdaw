import { describe, it, expect, vi, beforeEach } from 'vitest';

import { syncToasterPadParam } from '../helpers';
import { maybeRecordAutomation } from '../maybeRecordAutomation';

describe('setTrackGainPan helpers', () => {
    describe('syncToasterPadParam', () => {
        const deps = {
            updateDeviceParam: vi.fn(),
            getAllTracks: vi.fn(),
        };

        beforeEach(() => vi.clearAllMocks());

        it('bails if track has no parentId', () => {
            deps.getAllTracks.mockReturnValue([{ id: 't1', parentId: null }]);
            syncToasterPadParam('t1', 'volume', 0.5, deps);
            expect(deps.updateDeviceParam).not.toHaveBeenCalled();
        });

        it('syncs param if parent has a toaster device', () => {
            const tracks = [
                { id: 'parent1', devices: [{ type: 'toaster', id: 'd1' }] },
                { id: 't1', parentId: 'parent1' },
                { id: 't2', parentId: 'parent1' },
            ];
            deps.getAllTracks.mockReturnValue(tracks);

            // t1 is the first child of parent1 -> pad_0
            syncToasterPadParam('t1', 'volume', 0.7, deps);

            expect(deps.updateDeviceParam).toHaveBeenCalledWith('parent1', 'd1', 'pad_0_volume', 0.7);
        });
    });

    describe('maybeRecordAutomation', () => {
        const deps = {
            getTransportValue: vi.fn(),
            getTrackById: vi.fn(),
            recordAutomationValue: vi.fn(),
        };

        beforeEach(() => vi.clearAllMocks());

        it('bails if not playing', () => {
            deps.getTransportValue.mockReturnValue({ isPlaying: false });
            maybeRecordAutomation(deps, 't1', 'gain', 0.5);
            expect(deps.recordAutomationValue).not.toHaveBeenCalled();
        });

        it('records if playing and track is in a recording mode', () => {
            deps.getTransportValue.mockReturnValue({ isPlaying: true, playheadPosition: 4 });
            deps.getTrackById.mockReturnValue({ id: 't1', automationMode: 'touch' });

            maybeRecordAutomation(deps, 't1', 'gain', 0.9);

            expect(deps.recordAutomationValue).toHaveBeenCalledWith('t1', 'gain', 0.9, 4);
        });

        it('bails if track automation mode is read', () => {
            deps.getTransportValue.mockReturnValue({ isPlaying: true });
            deps.getTrackById.mockReturnValue({ id: 't1', automationMode: 'read' });

            maybeRecordAutomation(deps, 't1', 'gain', 0.9);

            expect(deps.recordAutomationValue).not.toHaveBeenCalled();
        });
    });
});
