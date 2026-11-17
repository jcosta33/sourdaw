import { getHeads, toJS } from '@automerge/automerge';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectLifecycle } from '#/app/registerProjectLifecycle';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip, addTrack, renameTrack } from '#/modules/Arrangement/useCases';
import {
    captureProjectRevision,
    getCrdtDoc,
    loadCrdtProject,
    persistCrdtProject,
    projectCrdtToStores,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { setMidiStoreState } from '#/modules/MIDI/useCases';

import { arrangementStore } from '../../../../stores/arrangementStore';
import { projectStore } from '../../../../stores/projectStore';
import { switchArrangement } from '../../../arrangement/switchArrangement';
import { takeSnapshot } from '../../../arrangement/takeSnapshot';
import { createFreshProjectMetadata } from '../../../createFreshProjectMetadata';
import { hydrateArrangementStoreFromProjectData } from '../../helpers/hydrateArrangementStoreFromProjectData';
import { isHydratableProjectData } from '../../helpers/isHydratableProjectData';
import { resetModuleStoresToDefault } from '../../helpers/resetModuleStoresToDefault';
import { buildProjectData } from '../buildProjectData';
import { rackProcessorReader } from '../rackProcessorReader';
import { serializeArrangementTracks } from '../serializeArrangementTracks';

// Playback shutdown is outside this serialization seam. The switch, its
// snapshots, storage writes and audio-reference preparation remain real.
vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    stopPlayback: vi.fn(() => Promise.resolve()),
}));

function nativeRoot() {
    const root = getCrdtDoc('root');
    if (!root) {
        throw new Error('Expected the real native project root');
    }
    return root;
}

function prepareProject() {
    resetCrdtProjectAuthority('Projection');
    resetModuleStoresToDefault();
    projectStore.set(createFreshProjectMetadata({ name: 'Projection', initialized: true, loading: false }));
    const track = addTrack({ id: 'live-track', name: 'Before edit', kind: 'midi', withoutDefaultDevice: true });
    if (!track) {
        throw new Error('Expected the real track owner to create a track');
    }
    const inactive = takeSnapshot('inactive', 'Inactive');
    const staleActive = takeSnapshot('active', 'Active');
    arrangementStore.set({ arrangements: [staleActive, inactive], activeArrangementId: 'active' });
    renameTrack(track.id, 'Fresh live track');
    const clip = addClip({
        id: 'live-clip',
        trackId: track.id,
        name: 'Fresh MIDI',
        startBeat: 4,
        endBeat: 8,
        type: 'midi',
    });
    if (!clip) {
        throw new Error('Expected the real clip owner to create a clip');
    }
    setMidiStoreState({
        noteCoordinateFormat: 'clip-relative',
        notesByClipId: {
            [clip.id]: [
                {
                    id: 'note',
                    pitch: 64,
                    startBeat: 0.5,
                    duration: 1,
                    velocity: 91,
                    probability: 73,
                    pressure: 12,
                    pitchBend: 2,
                    expression: { slide: [{ offsetBeats: 0.25, value: 40 }] },
                },
            ],
        },
        ccByClipId: { [clip.id]: [{ beat: 0.5, controller: 1, value: 64, channel: 2 }] },
        pitchBendByClipId: { [clip.id]: [{ beat: 1, value: 1024, channel: 2, channelScoped: true }] },
    });
    recordActionHistoryEntry({
        id: 'prior-edit',
        label: 'Rename track',
        actionKind: 'renameTrack',
        source: 'manual',
        timestamp: 1,
        reverted: false,
    });
    flushAutomergeStorageWrites();
    return { inactive, staleActive, trackId: track.id };
}

describe('buildProjectData active arrangement projection with native authority', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', new IDBFactory());
        vi.stubGlobal('IDBKeyRange', IDBKeyRange);
        registerProjectLifecycle();
        registerProjectSlotProjections();
        registerSupportingServicePorts();
        rackProcessorReader.configure(emptyRacks);
        registerCrdtStorageRuntime();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('projects fresh active content without writing native truth, and preserves native reload, JSON hydration and switching', async () => {
        const { inactive, staleActive, trackId } = prepareProject();
        await persistCrdtProject();
        const root = nativeRoot();
        const heads = getHeads(root);
        const truth = toJS(root);
        expect(truth).toMatchObject({ actionHistory: { entries: [{ id: 'prior-edit' }] } });
        const revision = captureProjectRevision();
        const liveTracks = structuredClone(trackStore.value);
        const liveMidi = structuredClone(midiStore.value);
        const arrangements = structuredClone(arrangementStore.value);

        const built = await buildProjectData();
        if (!built) {
            throw new Error('Expected a serializable native project');
        }

        expect(getHeads(nativeRoot())).toEqual(heads);
        expect(toJS(nativeRoot())).toEqual(truth);
        expect(arrangementStore.value).toEqual(arrangements);
        expect(built.snapshotRevision).toBe(revision);
        expect(built.data.arrangements?.[0]?.tracks?.selectedTrackId).toBe(liveTracks?.selectedTrackId);
        expect(built.data.arrangements?.[0]?.tracks?.tracks[0]?.name).toBe('Fresh live track');
        expect(built.data.arrangements?.[0]?.midi).toEqual({
            notesByClipId: liveMidi?.notesByClipId,
            ccByClipId: liveMidi?.ccByClipId,
            pitchBendByClipId: liveMidi?.pitchBendByClipId,
            noteCoordinateFormat: 'clip-relative',
        });
        expect(built.data.arrangements?.[1]).toEqual({
            ...inactive,
            tracks: {
                ...inactive.tracks,
                tracks: serializeArrangementTracks(inactive.tracks.tracks, inactive.midi.notesByClipId),
            },
        });

        // Reload the actual binary IndexedDB project, not the JSON projection.
        renameTrack(trackId, 'Unsaved later edit');
        flushAutomergeStorageWrites();
        await expect(loadCrdtProject()).resolves.toBe(true);
        projectCrdtToStores({ resetProjections: true });
        expect(getHeads(nativeRoot())).toEqual(heads);
        expect(toJS(nativeRoot())).toEqual(truth);
        expect(arrangementStore.value?.arrangements[0]).toEqual(staleActive);
        expect(trackStore.value?.tracks).toEqual(liveTracks?.tracks);
        expect(trackStore.value?.selectedTrackId).toBeNull();
        expect(midiStore.value).toEqual(liveMidi);

        await switchArrangement('inactive');
        expect(trackStore.value?.tracks[0]?.name).toBe('Before edit');
        await switchArrangement('active');
        expect(trackStore.value?.tracks).toEqual(liveTracks?.tracks);
        expect(midiStore.value?.notesByClipId).toEqual(liveMidi?.notesByClipId);
        expect(midiStore.value?.ccByClipId).toEqual(liveMidi?.ccByClipId);
        expect(midiStore.value?.pitchBendByClipId).toEqual(liveMidi?.pitchBendByClipId);

        const projectFileJson = JSON.stringify(built.data);
        const saved: unknown = JSON.parse(projectFileJson);
        if (!isHydratableProjectData(saved)) {
            throw new Error('Expected the real builder output to pass JSON admission');
        }
        hydrateArrangementStoreFromProjectData({ data: saved, preserveSavedArrangements: true });
        expect(trackStore.value?.tracks).toEqual(liveTracks?.tracks);
        expect(trackStore.value?.selectedTrackId).toBe(liveTracks?.selectedTrackId);
        expect(midiStore.value?.notesByClipId).toEqual(liveMidi?.notesByClipId);
        expect(midiStore.value?.ccByClipId).toEqual(liveMidi?.ccByClipId);
        expect(midiStore.value?.pitchBendByClipId).toEqual(liveMidi?.pitchBendByClipId);
        expect(midiStore.value?.noteCoordinateFormat).toBe('clip-relative');
    });

    it('settles a pending real owner write before capturing the file revision', async () => {
        const { trackId } = prepareProject();
        const before = getHeads(nativeRoot());
        renameTrack(trackId, 'Pending owner rename');
        expect(getHeads(nativeRoot())).toEqual(before);

        const built = await buildProjectData();

        expect(getHeads(nativeRoot())).not.toEqual(before);
        expect(toJS(nativeRoot())).toMatchObject({ tracks: { tracks: [{ name: 'Pending owner rename' }] } });
        expect(built?.snapshotRevision).toBe(captureProjectRevision());
        expect(built?.data.arrangements?.[0]?.tracks?.tracks[0]?.name).toBe('Pending owner rename');
    });
});

const emptyRacks = { readProcessors: () => [] };
