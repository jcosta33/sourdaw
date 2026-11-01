import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { reconcileRoutingAfterRemoval } from '../../../services/reconcileRoutingAfterRemoval';
import { handleRemoveAllTracks } from '../handleRemoveAllTracks';
import { handleRestoreTracks } from '../restoreTracks';

type Project = { tracks: Track[]; selectedTrackId: string | null; ghostClips: [] };

const mocks = vi.hoisted(() => ({
    project: { value: null as Project | null },
}));

function currentProject(): Project {
    if (!mocks.project.value) {
        throw new Error('Expected a seeded project');
    }
    return mocks.project.value;
}

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: () => mocks.project.value,
}));
vi.mock('../../../useCases/setTrackState', () => ({
    setTrackState: (next: unknown) => {
        mocks.project.value = next;
    },
}));
// Stands in for the real use case's project write: refuse master, otherwise drop the row and resolve routing the same way.
vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: (trackId: string) => {
        const state = currentProject();
        const removed = state.tracks.find((track) => track.id === trackId);
        if (!removed || removed.kind === 'master') {
            return { removed: false };
        }
        const { tracks } = reconcileRoutingAfterRemoval({
            removedTrackId: trackId,
            removedOutputId: removed.outputId,
            remainingTracks: state.tracks.filter((track) => track.id !== trackId),
        });
        mocks.project.value = { ...state, tracks };
        return { removed: true, finalizeRuntimeRemoval: () => undefined };
    },
}));
vi.mock('../../../useCases/removeTrackModulationReferences', () => ({
    removeTrackModulationReferences: () => ({ afterCommit: () => undefined, afterAmbiguousCommit: () => undefined }),
}));
vi.mock('../../../useCases/publishTrackRemoved', () => ({ publishTrackRemoved: vi.fn() }));
vi.mock('../../../useCases/publishTrackAdded', () => ({ publishTrackAdded: vi.fn() }));
vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({ projectTrackToLiveStrip: vi.fn() }));
vi.mock('../../../useCases/refreshToasterPadBindings', () => ({ refreshToasterPadBindings: vi.fn() }));
vi.mock('../../../useCases/captureTrackRemovalRuntimeAuthority', () => ({
    captureTrackRemovalRuntimeAuthority: () => ({
        isCurrent: () => true,
        guard: (effect: () => void) => effect,
        guardAbsent: (_trackId: string, effect: () => void) => effect,
    }),
}));
vi.mock('../../../useCases/comping/insertTakeLane', () => ({ insertTakeLane: vi.fn() }));
vi.mock('../../../stores/takeLaneStore', () => ({ takeLaneStore: { value: { lanes: [] }, set: vi.fn() } }));
vi.mock('../../../stores/clipSatelliteState', () => ({
    readClipSatelliteEntry: vi.fn(),
    writeClipSatelliteEntry: vi.fn(),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({ rearmCommittedTrackInputMonitoring: vi.fn() }));
vi.mock('#/modules/Automation/useCases', () => ({
    restoreAutomationLanes: vi.fn(),
    restoreTrackModulationReferences: vi.fn(),
}));
vi.mock('#/modules/MIDI/useCases', () => ({ restoreMidiClipData: vi.fn() }));
vi.mock('#/modules/Routing/useCases', () => ({
    ensureBusStrip: vi.fn(),
    getAllSidechainRoutes: () => [],
    restoreSidechainRoutes: () => () => undefined,
    setBusGain: vi.fn(),
    wireSidechainRoutes: vi.fn(),
}));

const send = (busId: string) => ({ busId, level: 0.5, preFader: false });

function masterOf(tracks: readonly Track[]): Track {
    const master = tracks.find((track) => track.kind === 'master');
    if (!master) {
        throw new Error('Expected a master track');
    }
    return master;
}

function routing(track: Track): { outputId: string; sends: Track['sends'] } {
    return { outputId: track.outputId, sends: track.sends };
}

function seed(masterRouting: { outputId: string; sends: Track['sends'] }, masterFirst: boolean): Track[] {
    const master = TrackDummy.create({ id: 'master', kind: 'master', ...masterRouting });
    const others = [
        TrackDummy.create({ id: 'drums', outputId: 'bus-1' }),
        TrackDummy.create({ id: 'bus-1', kind: 'bus', outputId: 'master' }),
        TrackDummy.create({ id: 'bus-2', kind: 'bus', outputId: 'master' }),
    ];
    const tracks = masterFirst ? [master, ...others] : [...others, master];
    mocks.project.value = { tracks, selectedTrackId: null, ghostClips: [] };
    return structuredClone(tracks);
}

function removeAllThenUndo(): { status: string } {
    const action = { type: 'removeAllTracks' as const, payload: undefined };
    const description = handleRemoveAllTracks.describe(action);
    handleRemoveAllTracks.execute(action);
    expect(currentProject().tracks.map((track) => track.id)).toEqual(['master']);
    const inverse = description.inverseAction;
    if (!inverse || inverse.type !== 'restoreTracks') {
        throw new Error('expected a restoreTracks inverse action');
    }
    const result = handleRestoreTracks.execute(inverse);
    if (!result || result instanceof Promise) {
        throw new Error('expected a synchronous restore result');
    }
    return result;
}

describe('removeAllTracks undo with a surviving master', () => {
    beforeEach(() => {
        mocks.project.value = null;
    });

    it.each([
        ['sends to two buses', { outputId: 'hw_out', sends: [send('bus-1'), send('bus-2')] }],
        ['an output to one bus and a send to another', { outputId: 'bus-1', sends: [send('bus-2')] }],
        ['nothing removable', { outputId: 'hw_out', sends: [] }],
    ])('restores every track and master routing when master references %s', (_name, masterRouting) => {
        for (const masterFirst of [false, true]) {
            const original = seed(masterRouting, masterFirst);

            const result = removeAllThenUndo();

            expect(result.status).toBe('written');
            expect(currentProject().tracks.map((track) => track.id)).toEqual(original.map((track) => track.id));
            expect(routing(masterOf(currentProject().tracks))).toEqual(routing(masterOf(original)));
        }
    });

    it('carries a master routing patch on exactly one restore, the one that runs last', () => {
        seed({ outputId: 'hw_out', sends: [send('bus-1'), send('bus-2')] }, false);

        const inverse = handleRemoveAllTracks.describe({ type: 'removeAllTracks', payload: undefined }).inverseAction;
        if (!inverse || inverse.type !== 'restoreTracks') {
            throw new Error('expected a restoreTracks inverse action');
        }

        const carriers = inverse.payload.restores.filter((restore) =>
            restore.routingPatches.some((patch) => patch.trackId === 'master')
        );
        expect(carriers.map((restore) => restore.trackId)).toEqual(['bus-2']);
        expect(carriers[0]?.routingPatches.filter((patch) => patch.trackId === 'master')).toHaveLength(1);
    });
});
