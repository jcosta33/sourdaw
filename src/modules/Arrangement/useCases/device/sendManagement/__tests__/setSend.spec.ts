import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setSend } from '../setSend';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    updateTrack: vi.fn(),
    engineSetSend: vi.fn(),
}));

vi.mock('../../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('../../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setSend: mocks.engineSetSend,
}));

describe('setSend', () => {
    beforeEach(() => vi.clearAllMocks());

    it('adds a new send and notifies engine', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', sends: [] });

        setSend('t1', 'bus1', 0.5, true);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updater = mocks.updateTrack.mock.calls[0][1];
        expect(updater({ sends: [] })).toEqual({ sends: [{ busId: 'bus1', level: 0.5, preFader: true }] });

        expect(mocks.engineSetSend).toHaveBeenCalledWith('t1', 'bus1', 0.5, true);
    });

    it('updates an existing send maintaining preFader state', () => {
        mocks.getTrackById.mockReturnValue({
            id: 't1',
            sends: [{ busId: 'bus1', level: 0.1, preFader: true }],
        });

        // Try to change level, passing false for preFader but it should stay true
        setSend('t1', 'bus1', 0.8, false);

        const updater = mocks.updateTrack.mock.calls[0][1];
        expect(updater({ sends: [{ busId: 'bus1', preFader: true }] })).toEqual({
            sends: [{ busId: 'bus1', level: 0.8, preFader: true }],
        });

        expect(mocks.engineSetSend).toHaveBeenCalledWith('t1', 'bus1', 0.8, true);
    });
});
