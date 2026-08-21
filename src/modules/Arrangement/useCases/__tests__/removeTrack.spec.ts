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
    setTrackOutput: vi.fn(),
    getAllSidechainRoutes: vi.fn().mockReturnValue([]),
    removeSidechainRoute: vi.fn(),
    removeClipSatelliteData: vi.fn(),
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
    setTrackOutput: ownerUseCases.setTrackOutput,
}));
vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: ownerUseCases.getAllSidechainRoutes,
    removeSidechainRoute: ownerUseCases.removeSidechainRoute,
}));
vi.mock('../../stores/takeLaneStore', () => ({
    takeLaneStore: {
        value: { lanes: [] },
        set: vi.fn(),
    },
}));
vi.mock('../clip/removeClipSatelliteData', () => ({
    removeClipSatelliteData: ownerUseCases.removeClipSatelliteData,
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
        ownerUseCases.setTrackOutput.mockReset();
        ownerUseCases.getAllSidechainRoutes.mockReset();
        ownerUseCases.getAllSidechainRoutes.mockReturnValue([]);
        ownerUseCases.removeSidechainRoute.mockReset();
        ownerUseCases.removeClipSatelliteData.mockReset();
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
            outputId: 'master',
            sends: [],
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
        // Regression (#2108): a removed track's clips must not leave their gain
        // envelope / warp state orphaned behind their retired clip ids.
        expect(ownerUseCases.removeClipSatelliteData).toHaveBeenCalledWith(['c1', 'c2', 'c3']);
        expect(mockEventBus.emit).toHaveBeenCalledWith('track.removed', { trackId: 't1' });
        // The engine strip for the deleted track must be torn down, otherwise its
        // node keeps processing in the live graph (leaked node).
        expect(ownerUseCases.removeTrackStrip).toHaveBeenCalledWith('t1');
        expect(ownerUseCases.removeBusStrip).not.toHaveBeenCalled();
    });

    it('can defer live-engine teardown until after the owning transaction commits', () => {
        const track = {
            id: 't1',
            name: 'One',
            kind: 'audio' as const,
            clips: [],
            outputId: 'master',
            sends: [],
            alternatives: [],
            parentId: null,
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [track as never],
            selectedTrackId: 't1',
        });
        vi.mocked(getTrackById).mockReturnValue(track as never);

        const result = removeTrack('t1', {
            deferRuntimeEffects: true,
            suppressRemovedEvent: true,
        });

        expect(setTrackState).toHaveBeenCalled();
        expect(ownerUseCases.removeTrackStrip).not.toHaveBeenCalled();
        expect(mockEventBus.emit).not.toHaveBeenCalled();
        if (!result.removed) {
            throw new Error('Expected the track removal to be staged');
        }

        result.finalizeRuntimeRemoval();

        expect(ownerUseCases.removeTrackStrip).toHaveBeenCalledWith('t1');
    });

    it('attempts dependent runtime reconciliation when strip teardown fails', () => {
        const failure = new Error('strip teardown failed');
        const removed = {
            id: 'bus-a',
            name: 'Bus A',
            kind: 'bus' as const,
            clips: [],
            outputId: 'master',
            sends: [],
            parentId: null,
        };
        const dependent = {
            id: 'audio-1',
            name: 'Audio',
            kind: 'audio' as const,
            clips: [],
            outputId: 'bus-a',
            sends: [],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [removed, dependent] as never,
            selectedTrackId: null,
        });
        vi.mocked(getTrackById).mockReturnValue(removed as never);
        ownerUseCases.removeTrackStrip.mockImplementationOnce(() => {
            throw failure;
        });

        expect(() => removeTrack('bus-a')).toThrow(failure);

        expect(ownerUseCases.removeBusStrip).toHaveBeenCalledWith('bus-a');
        expect(ownerUseCases.setTrackOutput).toHaveBeenCalledWith('audio-1', 'master');
    });

    it('refreshes surviving Toaster siblings after removing a child stem', () => {
        const parent = {
            id: 'parent',
            kind: 'folder',
            clips: [],
            parentId: null,
            devices: [{ type: 'toaster' }],
            outputId: 'master',
            sends: [],
        };
        const removed = {
            id: 'stem-1',
            kind: 'audio',
            clips: [],
            parentId: 'parent',
            devices: [],
            outputId: 'parent',
            sends: [],
        };
        const survivor = {
            id: 'stem-2',
            kind: 'audio',
            clips: [],
            parentId: 'parent',
            devices: [],
            outputId: 'parent',
            sends: [],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [parent, removed, survivor] as never,
            selectedTrackId: null,
        });
        vi.mocked(getTrackById).mockReturnValue(removed as never);

        removeTrack('stem-1');

        expect(ownerUseCases.setTrackOutput).toHaveBeenCalledWith('stem-2', 'parent', {
            toasterParentTrackId: 'parent',
            padIndex: 0,
        });
        expect(vi.mocked(setTrackState).mock.invocationCallOrder[0]).toBeLessThan(
            ownerUseCases.setTrackOutput.mock.invocationCallOrder[0]!
        );
        expect(ownerUseCases.removeTrackStrip.mock.invocationCallOrder[0]).toBeLessThan(
            ownerUseCases.setTrackOutput.mock.invocationCallOrder[0]!
        );
    });

    it('should remove BOTH the engine bus strip and track strip when a bus track is deleted', () => {
        const bus = {
            id: 'bus-1',
            name: 'Reverb Bus',
            kind: 'bus' as const,
            clips: [],
            outputId: 'master',
            sends: [],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [bus as never],
            selectedTrackId: null,
        });
        vi.mocked(getTrackById).mockReturnValue(bus as never);

        removeTrack('bus-1');

        expect(ownerUseCases.removeBusStrip).toHaveBeenCalledWith('bus-1');
        // A bus is live-strip eligible, so it also owns a TrackNode (devices,
        // sends/sidechains sourced from the bus). removeBusStrip only
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
        // Master is live-strip eligible, so it owns a TrackNode too (e.g. via
        // handleRemoveAllTracks, which removes every track).
        const master = {
            id: 'master',
            name: 'Master',
            kind: 'master' as const,
            clips: [],
            outputId: 'hw_out',
            sends: [],
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
            devices: [],
            outputId: 'master',
            sends: [],
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

    it('should remove the engine track strip when a Toaster folder is deleted', () => {
        const toasterFolder = {
            id: 'toaster-1',
            name: 'Toaster',
            kind: 'folder' as const,
            clips: [],
            devices: [{ id: 'toaster-device', type: 'toaster' }],
            outputId: 'master',
            sends: [],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [toasterFolder as never],
            selectedTrackId: null,
        });
        vi.mocked(getTrackById).mockReturnValue(toasterFolder as never);

        removeTrack('toaster-1');

        expect(ownerUseCases.removeTrackStrip).toHaveBeenCalledWith('toaster-1');
        expect(ownerUseCases.removeBusStrip).not.toHaveBeenCalled();
    });

    it('should clean active clip MIDI for a legacy track without alternatives', () => {
        const track = {
            id: 'legacy-track',
            name: 'Legacy',
            kind: 'midi' as const,
            clips: [{ id: 'legacy-clip' }],
            outputId: 'master',
            sends: [],
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

    it('removes sidechain routes that reference the removed track as source or target', () => {
        const track = {
            id: 't1',
            name: 'One',
            kind: 'audio' as const,
            clips: [],
            outputId: 'master',
            sends: [],
        };
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [track as never],
            selectedTrackId: null,
        });
        vi.mocked(getTrackById).mockReturnValue(track as never);
        // A route where t1 is the source, a route where t1 is the target, and a
        // route referencing an unrelated track (must survive).
        ownerUseCases.getAllSidechainRoutes.mockReturnValue([
            { id: 'r1', sourceTrackId: 't1', targetTrackId: 'other' },
            { id: 'r2', sourceTrackId: 'other', targetTrackId: 't1' },
            { id: 'r3', sourceTrackId: 'other-a', targetTrackId: 'other-b' },
        ]);

        removeTrack('t1');

        // Only the two routes referencing t1 are torn down; the unrelated one survives.
        expect(ownerUseCases.removeSidechainRoute).toHaveBeenCalledWith('r1');
        expect(ownerUseCases.removeSidechainRoute).toHaveBeenCalledWith('r2');
        expect(ownerUseCases.removeSidechainRoute).not.toHaveBeenCalledWith('r3');
    });
    // FX-6: deleting a bus used to leave every dependent's `outputId` and every
    // send pointing at an id no track owns. The engine then resolved that dead
    // id through `getDefaultDestination`'s fallback and silently reseated the
    // track on master at full level.
    describe('bus-removal reconciliation (FX-6)', () => {
        const busB = { id: 'busB', name: 'B', kind: 'bus' as const, clips: [], outputId: 'master', sends: [] };
        const busA = { id: 'busA', name: 'A', kind: 'bus' as const, clips: [], outputId: 'busB', sends: [] };

        function readReconciledTracks(): { id: string; outputId: string; sends: { busId: string }[] }[] {
            const call = vi.mocked(setTrackState).mock.calls[0];
            if (!call) {
                throw new Error('expected setTrackState to have been called');
            }
            return (call[0] as { tracks: { id: string; outputId: string; sends: { busId: string }[] }[] }).tracks;
        }

        it('repoints a dependent output to the removed bus own destination', () => {
            // audio-1 → busA → busB. Deleting busA must leave audio-1 → busB:
            // that is where its signal already flowed, so busB's processing and
            // trim are preserved. Falling back to master would bypass both.
            const dependent = {
                id: 'audio-1',
                name: 'Kick',
                kind: 'audio' as const,
                clips: [],
                outputId: 'busA',
                sends: [],
            };
            vi.mocked(getTrackState).mockReturnValue({
                tracks: [busA, busB, dependent] as never,
                selectedTrackId: null,
            });
            vi.mocked(getTrackById).mockReturnValue(busA as never);

            removeTrack('busA');

            const tracks = readReconciledTracks();
            expect(tracks.find((track) => track.id === 'audio-1')?.outputId).toBe('busB');
            // The live graph must agree with project truth, not fall to hw_out.
            expect(ownerUseCases.setTrackOutput).toHaveBeenCalledWith('audio-1', 'busB');
        });

        it('drops sends that targeted the removed bus instead of leaving them dangling', () => {
            const dependent = {
                id: 'audio-1',
                name: 'Kick',
                kind: 'audio' as const,
                clips: [],
                outputId: 'master',
                sends: [
                    { busId: 'busA', level: 0.5, preFader: false },
                    { busId: 'busB', level: 0.25, preFader: true },
                ],
            };
            vi.mocked(getTrackState).mockReturnValue({
                tracks: [busA, busB, dependent] as never,
                selectedTrackId: null,
            });
            vi.mocked(getTrackById).mockReturnValue(busA as never);

            removeTrack('busA');

            const tracks = readReconciledTracks();
            expect(tracks.find((track) => track.id === 'audio-1')?.sends).toEqual([
                { busId: 'busB', level: 0.25, preFader: true },
            ]);
        });

        it('falls back to master when the removed bus own output is also gone', () => {
            const orphanBus = {
                id: 'busA',
                name: 'A',
                kind: 'bus' as const,
                clips: [],
                outputId: 'deleted-earlier',
                sends: [],
            };
            const dependent = {
                id: 'audio-1',
                name: 'Kick',
                kind: 'audio' as const,
                clips: [],
                outputId: 'busA',
                sends: [],
            };
            vi.mocked(getTrackState).mockReturnValue({
                tracks: [orphanBus, dependent] as never,
                selectedTrackId: null,
            });
            vi.mocked(getTrackById).mockReturnValue(orphanBus as never);

            removeTrack('busA');

            const tracks = readReconciledTracks();
            expect(tracks.find((track) => track.id === 'audio-1')?.outputId).toBe('master');
        });

        it('leaves tracks that never referenced the removed bus untouched', () => {
            const unrelated = {
                id: 'audio-2',
                name: 'Bass',
                kind: 'audio' as const,
                clips: [],
                outputId: 'busB',
                sends: [{ busId: 'busB', level: 0.4, preFader: false }],
            };
            vi.mocked(getTrackState).mockReturnValue({
                tracks: [busA, busB, unrelated] as never,
                selectedTrackId: null,
            });
            vi.mocked(getTrackById).mockReturnValue(busA as never);

            removeTrack('busA');

            const tracks = readReconciledTracks();
            const survivor = tracks.find((track) => track.id === 'audio-2');
            expect(survivor?.outputId).toBe('busB');
            expect(survivor?.sends).toEqual([{ busId: 'busB', level: 0.4, preFader: false }]);
            expect(ownerUseCases.setTrackOutput).not.toHaveBeenCalledWith('audio-2', expect.anything());
        });

        // FX-6 must not violate the FX-2 invariant. Stored and imported projects
        // can already carry a cycle — nothing guarded these writes before this
        // fix, and `hydrateArrangementTracks` / DAWproject import still do not
        // validate. Inheriting the removed track's destination blindly can then
        // hand a survivor an edge that closes a loop, and a Web Audio cycle with
        // no DelayNode is silently muted: deleting a bus to *fix* a broken loop
        // would produce total silence.
        describe('reconciliation never closes a cycle', () => {
            it('does not repoint a dependent onto itself when the removed bus fed it back', () => {
                // Kick → busA → Kick. Inheriting busA's destination verbatim
                // would write Kick.outputId = Kick.
                const kick = {
                    id: 'kick',
                    name: 'Kick',
                    kind: 'audio' as const,
                    clips: [],
                    outputId: 'busA',
                    sends: [],
                };
                const loopedBus = {
                    id: 'busA',
                    name: 'A',
                    kind: 'bus' as const,
                    clips: [],
                    outputId: 'kick',
                    sends: [],
                };
                vi.mocked(getTrackState).mockReturnValue({
                    tracks: [kick, loopedBus] as never,
                    selectedTrackId: null,
                });
                vi.mocked(getTrackById).mockReturnValue(loopedBus as never);

                removeTrack('busA');

                const tracks = readReconciledTracks();
                const survivor = tracks.find((track) => track.id === 'kick');
                expect(survivor?.outputId).not.toBe('kick');
                expect(survivor?.outputId).toBe('master');
                expect(ownerUseCases.setTrackOutput).toHaveBeenCalledWith('kick', 'master');
            });

            it('does not relocate a pre-existing cycle onto the survivors', () => {
                // busA → busB → busC → busA. Removing busB must not leave
                // busA → busC while busC still routes back to busA.
                const busA = { id: 'busA', name: 'A', kind: 'bus' as const, clips: [], outputId: 'busB', sends: [] };
                const busB = { id: 'busB', name: 'B', kind: 'bus' as const, clips: [], outputId: 'busC', sends: [] };
                const busC = { id: 'busC', name: 'C', kind: 'bus' as const, clips: [], outputId: 'busA', sends: [] };
                vi.mocked(getTrackState).mockReturnValue({
                    tracks: [busA, busB, busC] as never,
                    selectedTrackId: null,
                });
                vi.mocked(getTrackById).mockReturnValue(busB as never);

                removeTrack('busB');

                const tracks = readReconciledTracks();
                const survivorA = tracks.find((track) => track.id === 'busA');
                // busC still outputs to busA, so inheriting busC would close a loop.
                expect(survivorA?.outputId).not.toBe('busC');
                expect(survivorA?.outputId).toBe('master');
                expect(tracks.find((track) => track.id === 'busC')?.outputId).toBe('busA');
            });

            it('still inherits the removed destination when doing so stays acyclic', () => {
                // The guard must not make every removal fall back to master.
                const busB = {
                    id: 'busB',
                    name: 'B',
                    kind: 'bus' as const,
                    clips: [],
                    outputId: 'master',
                    sends: [],
                };
                const busA = { id: 'busA', name: 'A', kind: 'bus' as const, clips: [], outputId: 'busB', sends: [] };
                const dependent = {
                    id: 'audio-1',
                    name: 'Kick',
                    kind: 'audio' as const,
                    clips: [],
                    outputId: 'busA',
                    sends: [],
                };
                vi.mocked(getTrackState).mockReturnValue({
                    tracks: [busA, busB, dependent] as never,
                    selectedTrackId: null,
                });
                vi.mocked(getTrackById).mockReturnValue(busA as never);

                removeTrack('busA');

                expect(readReconciledTracks().find((track) => track.id === 'audio-1')?.outputId).toBe('busB');
            });
        });
    });
});
