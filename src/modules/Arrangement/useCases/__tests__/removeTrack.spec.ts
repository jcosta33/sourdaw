import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { getTrackById } from '../../repositories/track/getTrackById';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { removeTrack } from '../removeTrack';

const ownerUseCases = vi.hoisted(() => ({
    removeAutomationLanesForTrack: vi.fn(),
    removeMidiClipData: vi.fn(),
    removeTrackStrip: vi.fn(),
    removeBusStrip: vi.fn(),
}));

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: vi.fn(),
}));
vi.mock('../../repositories/track/getTrackById', () => ({
    getTrackById: vi.fn(),
}));
vi.mock('../../repositories/track/setTrackState', () => ({
    setTrackState: vi.fn(),
}));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    removeAutomationLanesForTrack: ownerUseCases.removeAutomationLanesForTrack,
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    removeMidiClipData: ownerUseCases.removeMidiClipData,
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    removeTrackStrip: ownerUseCases.removeTrackStrip,
    removeBusStrip: ownerUseCases.removeBusStrip,
}));
vi.mock('../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: { lanes: [] },
        set: vi.fn(),
    },
}));

const mockEventBus = {
    emit: vi.fn(),
};

describe('removeTrack', () => {
    beforeEach(() => {
        injectDependencies(removeTrack, { eventBus: mockEventBus });
        vi.mocked(getTrackState).mockReset();
        vi.mocked(getTrackById).mockReset();
        vi.mocked(setTrackState).mockReset();
        mockEventBus.emit.mockReset();
        ownerUseCases.removeAutomationLanesForTrack.mockReset();
        ownerUseCases.removeMidiClipData.mockReset();
        ownerUseCases.removeTrackStrip.mockReset();
        ownerUseCases.removeBusStrip.mockReset();
    });

    it('should return early when track state is missing', () => {
        vi.mocked(getTrackState).mockReturnValue(null);

        removeTrack('t1');

        expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should return early when track id is unknown', () => {
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null });
        vi.mocked(getTrackById).mockReturnValue(undefined);

        removeTrack('missing');

        expect(setTrackState).not.toHaveBeenCalled();
        expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should remove track, clean related state, and emit track.removed', () => {
        const track = {
            id: 't1',
            name: 'One',
            kind: 'audio' as const,
            clips: [{ id: 'c1' }],
            alternatives: [
                { id: 'alt-active', name: 'Active', clips: [{ id: 'c1' }, { id: 'c2' }] },
                { id: 'alt-inactive', name: 'Inactive', clips: [{ id: 'c3' }, { id: 'c1' }] },
            ],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [track as never],
            selectedTrackId: 't1',
        });
        vi.mocked(getTrackById).mockReturnValue(track as never);

        removeTrack('t1');

        expect(setTrackState).toHaveBeenCalled();
        expect(ownerUseCases.removeAutomationLanesForTrack).toHaveBeenCalledWith('t1');
        expect(ownerUseCases.removeMidiClipData).toHaveBeenCalledWith(['c1', 'c2', 'c3']);
        expect(mockEventBus.emit).toHaveBeenCalledWith('track.removed', { trackId: 't1' });
        // The engine strip for the deleted track must be torn down, otherwise its
        // node keeps processing in the live graph (leaked node).
        expect(ownerUseCases.removeTrackStrip).toHaveBeenCalledWith('t1');
        expect(ownerUseCases.removeBusStrip).not.toHaveBeenCalled();
    });

    it('should remove BOTH the engine bus strip and track strip when a bus track is deleted', () => {
        const bus = {
            id: 'bus-1',
            name: 'Reverb Bus',
            kind: 'bus' as const,
            clips: [],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [bus as never],
            selectedTrackId: null,
        });
        vi.mocked(getTrackById).mockReturnValue(bus as never);

        removeTrack('bus-1');

        expect(ownerUseCases.removeBusStrip).toHaveBeenCalledWith('bus-1');
        // ensureTrackStrips skips only 'folder', so a bus also owns a TrackNode
        // (devices, sends/sidechains sourced from the bus). removeBusStrip only
        // disposes the BusNode — the TrackNode must be torn down too or it leaks.
        expect(ownerUseCases.removeTrackStrip).toHaveBeenCalledWith('bus-1');
        // Order is load-bearing: the TrackNode sweep (sends/sidechains keyed on
        // this id as SOURCE) must run before the BusNode disposal so dependent
        // connections are gone before the summing node is torn down.
        const trackStripOrder = ownerUseCases.removeTrackStrip.mock.invocationCallOrder[0]!;
        const busStripOrder = ownerUseCases.removeBusStrip.mock.invocationCallOrder[0]!;
        expect(trackStripOrder).toBeLessThan(busStripOrder);
        expect(mockEventBus.emit).toHaveBeenCalledWith('track.removed', { trackId: 'bus-1' });
    });

    it('should remove the engine track strip when the master track is deleted', () => {
        // ensureTrackStrips skips only 'folder', so master owns a TrackNode too
        // (e.g. via handleRemoveAllTracks, which removes every track).
        const master = {
            id: 'master',
            name: 'Master',
            kind: 'master' as const,
            clips: [],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [master as never],
            selectedTrackId: null,
        });
        vi.mocked(getTrackById).mockReturnValue(master as never);

        removeTrack('master');

        expect(ownerUseCases.removeTrackStrip).toHaveBeenCalledWith('master');
        expect(ownerUseCases.removeBusStrip).not.toHaveBeenCalled();
        expect(mockEventBus.emit).toHaveBeenCalledWith('track.removed', { trackId: 'master' });
    });

    it('should not touch engine strips when a folder track is deleted', () => {
        const folder = {
            id: 'folder-1',
            name: 'Drums',
            kind: 'folder' as const,
            clips: [],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [folder as never],
            selectedTrackId: null,
        });
        vi.mocked(getTrackById).mockReturnValue(folder as never);

        removeTrack('folder-1');

        expect(ownerUseCases.removeTrackStrip).not.toHaveBeenCalled();
        expect(ownerUseCases.removeBusStrip).not.toHaveBeenCalled();
        expect(mockEventBus.emit).toHaveBeenCalledWith('track.removed', { trackId: 'folder-1' });
    });

    it('should clean active clip MIDI for a legacy track without alternatives', () => {
        const track = {
            id: 'legacy-track',
            name: 'Legacy',
            kind: 'midi' as const,
            clips: [{ id: 'legacy-clip' }],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [track as never],
            selectedTrackId: null,
        });
        vi.mocked(getTrackById).mockReturnValue(track as never);

        removeTrack('legacy-track');

        expect(ownerUseCases.removeMidiClipData).toHaveBeenCalledWith(['legacy-clip']);
        expect(mockEventBus.emit).toHaveBeenCalledWith('track.removed', { trackId: 'legacy-track' });
    });
});
