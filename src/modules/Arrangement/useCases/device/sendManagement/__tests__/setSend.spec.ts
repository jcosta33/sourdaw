import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setSend } from '../setSend';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    getAllTracks: vi.fn(),
    updateTrack: vi.fn(),
    engineSetSend: vi.fn(),
    engineRemoveSend: vi.fn(),
    getAllSidechainRoutes: vi.fn(),
}));

vi.mock('../../../../repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('../../../../repositories/track/getAllTracks', () => ({
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('../../../../repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setSend: mocks.engineSetSend,
    removeSend: mocks.engineRemoveSend,
    getAllSidechainRoutes: mocks.getAllSidechainRoutes,
}));

describe('setSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllTracks.mockReturnValue([]);
        mocks.getAllSidechainRoutes.mockReturnValue([]);
    });

    it('adds a new send and notifies engine', () => {
        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', sends: [] });

        const didWrite = setSend('t1', 'bus1', 0.5, true);

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        const updateCall = mocks.updateTrack.mock.calls[0];
        if (!updateCall) {
            throw new Error('expected updateTrack to have been called');
        }
        const updater = updateCall[1];
        expect(updater({ sends: [] })).toEqual({ sends: [{ busId: 'bus1', level: 0.5, preFader: true }] });

        expect(mocks.engineSetSend).toHaveBeenCalledWith('t1', 'bus1', 0.5, true);
        expect(didWrite).toBe(true);
    });

    it('defers the live engine send until the project transaction commits', () => {
        const source: {
            id: string;
            kind: 'audio';
            sends: Array<{ busId: string; level: number; preFader: boolean }>;
        } = { id: 't1', kind: 'audio', sends: [] };
        const target = { id: 'bus1', kind: 'bus', sends: [] };
        mocks.getTrackById.mockImplementation((trackId: string) => {
            if (trackId === source.id) {
                return source;
            }
            return target;
        });

        const runtimeEffect = setSend('t1', 'bus1', 0.5, false, { deferRuntimeEffect: true });

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
        if (!runtimeEffect) {
            throw new Error('expected a deferred runtime effect');
        }
        runtimeEffect.afterCommit();
        runtimeEffect.afterCommit();
        expect(mocks.engineSetSend).toHaveBeenCalledOnce();
        expect(mocks.engineSetSend).toHaveBeenCalledWith('t1', 'bus1', 0.5, false);

        source.sends = [{ busId: 'bus1', level: 0.7, preFader: true }];
        runtimeEffect.afterAmbiguousCommit();
        expect(mocks.engineSetSend).toHaveBeenLastCalledWith('t1', 'bus1', 0.7, true);
    });

    it('updates an existing send maintaining preFader state', () => {
        mocks.getTrackById.mockReturnValue({
            id: 't1',
            kind: 'audio',
            sends: [{ busId: 'bus1', level: 0.1, preFader: true }],
        });

        // Try to change level, passing false for preFader but it should stay true
        setSend('t1', 'bus1', 0.8, false);

        const updateCall = mocks.updateTrack.mock.calls[0];
        if (!updateCall) {
            throw new Error('expected updateTrack to have been called');
        }
        const updater = updateCall[1];
        expect(updater({ sends: [{ busId: 'bus1', preFader: true }] })).toEqual({
            sends: [{ busId: 'bus1', level: 0.8, preFader: true }],
        });

        expect(mocks.engineSetSend).toHaveBeenCalledWith('t1', 'bus1', 0.8, true);
    });

    it('rejects dormant VCA send creation before project or engine work', () => {
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca', sends: [] });

        const didWrite = setSend('vca-1', 'bus1', 0.5);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('rejects a resolved dormant VCA send destination before project or engine work', () => {
        mocks.getTrackById.mockImplementation((trackId: string) => {
            if (trackId === 'audio-1') {
                return { id: 'audio-1', kind: 'audio', sends: [] };
            }
            return { id: 'vca-1', kind: 'vca', sends: [] };
        });

        const didWrite = setSend('audio-1', 'vca-1', 0.5);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('rejects a missing source or destination before project or engine work', () => {
        mocks.getTrackById.mockImplementation((trackId: string) =>
            trackId === 'audio-1' ? { id: 'audio-1', kind: 'audio', sends: [] } : undefined
        );

        const missingDestination = setSend('audio-1', 'missing-bus', 0.5);
        const missingSource = setSend('missing-track', 'audio-1', 0.5);

        expect(missingDestination).toBe(false);
        expect(missingSource).toBe(false);
        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
    });

    // FX-2: a Web Audio cycle with no DelayNode in it is muted by the spec's
    // rendering algorithm, so an unguarded self-send silently kills the track
    // rather than howling. The invariant lives here, at the mutation boundary.
    it('rejects a self-send before project or engine work', () => {
        const track = { id: 't1', kind: 'audio', outputId: 'master', sends: [] };
        mocks.getTrackById.mockReturnValue(track);
        mocks.getAllTracks.mockReturnValue([track]);

        const didWrite = setSend('t1', 't1', 0.5);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('rejects a send that closes an indirect bus A→B→C→A cycle', () => {
        // busA already reaches busC downstream: busA →(send) busB →(output) busC.
        // Sending busC → busA would close the loop.
        const busA = { id: 'busA', kind: 'bus', outputId: 'master', sends: [{ busId: 'busB', level: 1 }] };
        const busB = { id: 'busB', kind: 'bus', outputId: 'busC', sends: [] };
        const busC = { id: 'busC', kind: 'bus', outputId: 'master', sends: [] };
        mocks.getAllTracks.mockReturnValue([busA, busB, busC]);
        mocks.getTrackById.mockImplementation((trackId: string) =>
            [busA, busB, busC].find((track) => track.id === trackId)
        );

        const didWrite = setSend('busC', 'busA', 0.75);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('accepts a send onto a bus that does not route back to the source', () => {
        // Same topology, opposite direction: busA → busC adds a diamond, not a loop.
        const busA = { id: 'busA', kind: 'bus', outputId: 'master', sends: [{ busId: 'busB', level: 1 }] };
        const busB = { id: 'busB', kind: 'bus', outputId: 'busC', sends: [] };
        const busC = { id: 'busC', kind: 'bus', outputId: 'master', sends: [] };
        mocks.getAllTracks.mockReturnValue([busA, busB, busC]);
        mocks.getTrackById.mockImplementation((trackId: string) =>
            [busA, busB, busC].find((track) => track.id === trackId)
        );

        const didWrite = setSend('busA', 'busC', 0.25);

        expect(mocks.engineSetSend).toHaveBeenCalledWith('busA', 'busC', 0.25, false);
        expect(didWrite).toBe(true);
    });

    it('rejects a send that closes a cycle through an existing sidechain edge', () => {
        // busA →(sidechain key) busB. A send busB → busA closes the loop even
        // though neither sends nor outputs alone reach back.
        const busA = { id: 'busA', kind: 'bus', outputId: 'master', sends: [] };
        const busB = { id: 'busB', kind: 'bus', outputId: 'master', sends: [] };
        mocks.getAllTracks.mockReturnValue([busA, busB]);
        mocks.getTrackById.mockImplementation((trackId: string) => [busA, busB].find((track) => track.id === trackId));
        mocks.getAllSidechainRoutes.mockReturnValue([{ sourceTrackId: 'busA', targetTrackId: 'busB' }]);

        const didWrite = setSend('busB', 'busA', 0.5);

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetSend).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });
});
