import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { getTrackById } from '../../repositories/track/getTrackById';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { removeTrack } from '../removeTrack';

const ownerUseCases = vi.hoisted(() => ({
    removeAutomationLanesForTrack: vi.fn(),
    removeMidiClipData: vi.fn(),
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
    });

    it('should return early when track state is missing', () => {
        vi.mocked(getTrackState).mockReturnValue(null);

        removeTrack('t1');

        expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should return early when track id is unknown', () => {
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null } as unknown as ReturnType<
            typeof getTrackState
        >);
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
        } as unknown as ReturnType<typeof getTrackState>);
        vi.mocked(getTrackById).mockReturnValue(track as never);

        removeTrack('t1');

        expect(setTrackState).toHaveBeenCalled();
        expect(ownerUseCases.removeAutomationLanesForTrack).toHaveBeenCalledWith('t1');
        expect(ownerUseCases.removeMidiClipData).toHaveBeenCalledWith(['c1', 'c2', 'c3']);
        expect(mockEventBus.emit).toHaveBeenCalledWith('track.removed', { trackId: 't1' });
    });
});
