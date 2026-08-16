import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackOutput } from '../setTrackOutput';

const mocks = vi.hoisted(() => ({
    getTrackById: vi.fn(),
    getAllTracks: vi.fn(),
    updateTrack: vi.fn(),
    engineSetTrackOutput: vi.fn(),
    applyRuntimeGraphDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    getRuntimeGraphRevision: vi.fn(() => 4),
    captureProjectRevision: vi.fn(() => 'project-revision-4'),
    getAllSidechainRoutes: vi.fn(),
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getAllSidechainRoutes: mocks.getAllSidechainRoutes,
}));

vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: mocks.updateTrack,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    setTrackOutput: mocks.engineSetTrackOutput,
    applyRuntimeGraphDelta: mocks.applyRuntimeGraphDelta,
    getRuntimeGraphRevision: mocks.getRuntimeGraphRevision,
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    captureProjectRevision: mocks.captureProjectRevision,
}));

describe('setTrackOutput', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAllTracks.mockReturnValue([]);
        mocks.getAllSidechainRoutes.mockReturnValue([]);
    });

    it('should update the track output id in the store and notify the audio engine', () => {
        mocks.getTrackById.mockImplementation((trackId: string) => {
            if (trackId === 't1') {
                return {
                    id: 't1',
                    kind: 'audio',
                    devices: [
                        {
                            id: 'compressor',
                            type: 'builtin-compressor',
                            parameterValues: { ratio: 4, attack: 20 },
                        },
                    ],
                };
            }
            return { id: 'bus-main', kind: 'bus', devices: [] };
        });

        const didWrite = setTrackOutput('t1', 'bus-main');

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));

        const patch = mocks.updateTrack.mock.calls[0]![1] as (t: { outputId: string; id: string }) => {
            outputId: string;
            id: string;
        };
        expect(patch({ outputId: 'old', id: 't1' })).toEqual({ outputId: 'bus-main', id: 't1' });

        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledWith({
            schemaVersion: 1,
            command: 'set-track-output',
            correlation: { appRevision: 4, projectRevision: 'project-revision-4' },
            nodes: [
                {
                    id: 't1',
                    kind: 'audio',
                    devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'ratio'] }],
                },
                { id: 'bus-main', kind: 'bus', devices: [] },
            ],
            edges: [{ kind: 'output', sourceId: 't1', targetId: 'bus-main' }],
            parameters: [],
        });
        expect(didWrite).toBe(true);
    });

    it('defers the live engine route until the project transaction commits', () => {
        mocks.getTrackById.mockImplementation((trackId: string) => {
            if (trackId === 't1') {
                return { id: 't1', kind: 'audio', devices: [] };
            }
            return { id: 'bus-main', kind: 'bus', devices: [] };
        });

        const runtimeEffect = setTrackOutput('t1', 'bus-main', { deferRuntimeEffect: true });

        expect(mocks.updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(mocks.engineSetTrackOutput).not.toHaveBeenCalled();
        if (!runtimeEffect) {
            throw new Error('expected a deferred runtime effect');
        }
        runtimeEffect.afterCommit();
        runtimeEffect.afterCommit();
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledOnce();

        mocks.getTrackById.mockReturnValue({ id: 't1', kind: 'audio', outputId: 'master', devices: [] });
        runtimeEffect.afterAmbiguousCommit();
        expect(mocks.applyRuntimeGraphDelta).toHaveBeenLastCalledWith(
            expect.objectContaining({ edges: [{ kind: 'output', sourceId: 't1', targetId: 'master' }] })
        );
    });

    it('rejects a missing source before project or engine work', () => {
        mocks.getTrackById.mockReturnValue(undefined);

        const didWrite = setTrackOutput('missing', 'bus-main');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetTrackOutput).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('preserves Toaster pad ownership across audible output round-trips', () => {
        const parent = {
            id: 'toaster-parent',
            kind: 'folder',
            devices: [{ id: 'toaster-device', type: 'toaster', parameterValues: {} }],
        };
        const child = { id: 'pad-track', kind: 'audio', parentId: parent.id, devices: [] };
        mocks.getAllTracks.mockReturnValue([parent, child]);
        mocks.getTrackById.mockImplementation((trackId: string) => {
            if (trackId === child.id) {
                return child;
            }
            if (trackId === 'return-bus') {
                return { id: 'return-bus', kind: 'bus', devices: [] };
            }
            return undefined;
        });

        setTrackOutput(child.id, 'return-bus');
        setTrackOutput(child.id, 'master');

        const padBinding = { toasterParentTrackId: parent.id, padIndex: 0 };
        expect(mocks.engineSetTrackOutput).toHaveBeenNthCalledWith(1, child.id, 'return-bus', padBinding);
        expect(mocks.engineSetTrackOutput).toHaveBeenNthCalledWith(2, child.id, 'master', padBinding);
    });

    it('rejects dormant VCA output assignment before project or engine work', () => {
        mocks.getTrackById.mockReturnValue({ id: 'vca-1', kind: 'vca' });

        const didWrite = setTrackOutput('vca-1', 'bus-main');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetTrackOutput).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('rejects a missing non-terminal destination before project or engine work', () => {
        mocks.getTrackById.mockImplementation((trackId: string) =>
            trackId === 'audio-1' ? { id: 'audio-1', kind: 'audio' } : undefined
        );

        const didWrite = setTrackOutput('audio-1', 'deleted-bus');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetTrackOutput).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('rejects a resolved dormant VCA output before project or engine work', () => {
        mocks.getTrackById.mockImplementation((trackId: string) => {
            if (trackId === 'audio-1') {
                return { id: 'audio-1', kind: 'audio' };
            }
            return { id: 'vca-1', kind: 'vca' };
        });

        const didWrite = setTrackOutput('audio-1', 'vca-1');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetTrackOutput).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    // FX-2: output edges close loops just as readily as sends do, and the
    // engine resolves outputId with no ancestry check, so the guard has to
    // cover this mutator too — not just setSend.
    it('rejects routing a track output to itself before project or engine work', () => {
        const track = { id: 't1', kind: 'audio', outputId: 'master', sends: [] };
        mocks.getTrackById.mockImplementation((trackId: string) => (trackId === 't1' ? track : undefined));
        mocks.getAllTracks.mockReturnValue([track]);

        const didWrite = setTrackOutput('t1', 't1');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetTrackOutput).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('rejects an output that closes an indirect bus A→B→C→A cycle', () => {
        // busA →(output) busB →(send) busC. Routing busC's output to busA closes it.
        const busA = { id: 'busA', kind: 'bus', outputId: 'busB', sends: [] };
        const busB = { id: 'busB', kind: 'bus', outputId: 'master', sends: [{ busId: 'busC', level: 1 }] };
        const busC = { id: 'busC', kind: 'bus', outputId: 'master', sends: [] };
        const tracks = [busA, busB, busC];
        mocks.getAllTracks.mockReturnValue(tracks);
        mocks.getTrackById.mockImplementation((trackId: string) => tracks.find((track) => track.id === trackId));

        const didWrite = setTrackOutput('busC', 'busA');

        expect(mocks.updateTrack).not.toHaveBeenCalled();
        expect(mocks.engineSetTrackOutput).not.toHaveBeenCalled();
        expect(didWrite).toBe(false);
    });

    it('accepts an output change that leaves the graph acyclic', () => {
        const busA = { id: 'busA', kind: 'bus', outputId: 'busB', sends: [], devices: [] };
        const busB = {
            id: 'busB',
            kind: 'bus',
            outputId: 'master',
            sends: [{ busId: 'busC', level: 1 }],
            devices: [],
        };
        const busC = { id: 'busC', kind: 'bus', outputId: 'master', sends: [], devices: [] };
        const tracks = [busA, busB, busC];
        mocks.getAllTracks.mockReturnValue(tracks);
        mocks.getTrackById.mockImplementation((trackId: string) => tracks.find((track) => track.id === trackId));

        const didWrite = setTrackOutput('busA', 'busC');

        expect(mocks.applyRuntimeGraphDelta).toHaveBeenCalledWith(
            expect.objectContaining({ edges: [{ kind: 'output', sourceId: 'busA', targetId: 'busC' }] })
        );
        expect(didWrite).toBe(true);
    });
});
vi.mock('#/modules/Arrangement/repositories/track/getTrackById', () => ({
    getTrackById: mocks.getTrackById,
}));

vi.mock('#/modules/Arrangement/repositories/track/getAllTracks', () => ({
    getAllTracks: mocks.getAllTracks,
}));
