import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { LEGACY_MIDI_PROBABILITY_SEED, midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { handleDiscardImportedStemSet, handleImportStemSet } from '../handleImportStemSet';

const mocks = vi.hoisted(() => ({
    activateExternalPlugin: vi.fn<() => void>(),
    initializeTrackStripFromSnapshot: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    promoteStagedAsset: vi.fn<(leaseId: string) => void>(),
    publishTrackAdded: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    publishTrackRemoved: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    removeBusStrip: vi.fn<() => void>(),
    removeTrackStrip: vi.fn<() => void>(),
    reportLatency: vi.fn<() => void>(),
    getRuntimeGraphRevision: vi.fn(() => 0),
    resolveToasterPadBinding: vi.fn(() => null),
    setSend: vi.fn<() => void>(),
    setTrackGain: vi.fn<() => void>(),
    setTrackMute: vi.fn<() => void>(),
    setTrackOutput: vi.fn<() => void>(),
    setTrackPan: vi.fn<() => void>(),
    setTrackSoloGate: vi.fn<() => void>(),
    updateDeviceBypass: vi.fn<() => void>(),
    updateDeviceParam: vi.fn<() => void>(),
    wireSidechainRoutes: vi.fn<() => void>(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    initializeTrackStripFromSnapshot: mocks.initializeTrackStripFromSnapshot,
    removeBusStrip: mocks.removeBusStrip,
    removeTrackStrip: mocks.removeTrackStrip,
    reportLatency: mocks.reportLatency,
    getRuntimeGraphRevision: mocks.getRuntimeGraphRevision,
    resolveToasterPadBinding: mocks.resolveToasterPadBinding,
    setTrackGain: mocks.setTrackGain,
    setTrackMute: mocks.setTrackMute,
    setTrackOutput: mocks.setTrackOutput,
    setTrackPan: mocks.setTrackPan,
    setTrackSoloGate: mocks.setTrackSoloGate,
    updateDeviceBypass: mocks.updateDeviceBypass,
    updateDeviceParam: mocks.updateDeviceParam,
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({ promoteStagedAsset: mocks.promoteStagedAsset }),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    activateExternalPlugin: mocks.activateExternalPlugin,
}));
vi.mock('#/modules/Routing/useCases', () => ({
    getAllSidechainRoutes: () => [],
    removeSidechainRoute: () => null,
    setSend: mocks.setSend,
    wireSidechainRoutes: mocks.wireSidechainRoutes,
}));
vi.mock('../../../useCases/publishTrackAdded', () => ({
    publishTrackAdded: mocks.publishTrackAdded,
}));
vi.mock('../../../useCases/publishTrackRemoved', () => ({
    publishTrackRemoved: mocks.publishTrackRemoved,
}));

type ImportStemSetAction = Extract<AppAction, { type: 'importStemSet' }>;
type DiscardImportedStemSetAction = Extract<AppAction, { type: 'discardImportedStemSet' }>;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const emptyMidiStoreState: MidiStoreState = {
    probabilitySeed: LEGACY_MIDI_PROBABILITY_SEED,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
};

function createStemImportAction(): ImportStemSetAction {
    return {
        type: 'importStemSet',
        payload: {
            selectionId: 'selection-stems',
            groupName: 'Starter Stems',
            projectTempo: 120,
            folderId: 'folder-starter-stems',
            folderColor: '#445566',
            stems: [
                {
                    stemId: 'stem-kick-source',
                    sourceName: 'Kick.wav',
                    role: 'kick',
                    sourceTempo: 120,
                    durationSeconds: 8,
                    sourceBytes: 1024,
                    decodedBytes: 2048,
                    audioBufferId: 'buffer-kick',
                    assetHash: 'hash-kick',
                    assetLeaseId: 'lease-kick',
                    trackId: 'track-kick',
                    trackName: 'Kick',
                    trackGain: 0.85,
                    trackPan: 0,
                    trackColor: '#ff3355',
                    clipId: 'clip-kick',
                },
                {
                    stemId: 'stem-vocal-source',
                    sourceName: 'Lead.wav',
                    role: 'lead-vocal',
                    sourceTempo: 120,
                    durationSeconds: 8,
                    sourceBytes: 2048,
                    decodedBytes: 4096,
                    audioBufferId: 'buffer-vocal',
                    assetHash: 'hash-vocal',
                    assetLeaseId: 'lease-vocal',
                    trackId: 'track-vocal',
                    trackName: 'Lead Vocal',
                    trackGain: 0.75,
                    trackPan: -0.1,
                    trackColor: '#33aaff',
                    clipId: 'clip-vocal',
                },
            ],
        },
    };
}

function requireTrackState() {
    const state = trackStore.value;
    if (!state) {
        throw new Error('Expected track store state');
    }
    return state;
}

function requireMidiState() {
    const state = midiStore.value;
    if (!state) {
        throw new Error('Expected MIDI store state');
    }
    return state;
}

function describeImportInverse(action: ImportStemSetAction): DiscardImportedStemSetAction {
    const inverse = handleImportStemSet.describe(action).inverseAction;
    if (!inverse || inverse.type !== 'discardImportedStemSet') {
        throw new Error('Expected discardImportedStemSet inverse');
    }
    return inverse;
}

async function applyStemImport(action: ImportStemSetAction): Promise<DiscardImportedStemSetAction> {
    const inverse = describeImportInverse(action);
    const result = await handleImportStemSet.execute(action);
    expect(result?.status).toBe('written');
    return inverse;
}

function validateDiscard(inverse: DiscardImportedStemSetAction): boolean | undefined {
    return handleDiscardImportedStemSet.validate?.(inverse, { actions: [inverse], actionIndex: 0 });
}

describe('handleImportStemSet', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('import stem set handler test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap({
            importStemSet: handleImportStemSet,
            discardImportedStemSet: handleDiscardImportedStemSet,
        });
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        setMidiStoreState(emptyMidiStoreState);
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        setMidiStoreState(emptyMidiStoreState);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('admits a guarded stem import into an atomic batch and undo executes the inverse exactly', async () => {
        const action = createStemImportAction();
        const preApplyInverse = describeImportInverse(action);

        expect(handleDiscardImportedStemSet.canReapplyAfterDivergence?.(preApplyInverse)).toBe(true);

        const result = await executeAppActionBatch([action], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(result).toMatchObject({ status: 'committed' });
        expect(requireTrackState().tracks.map((track) => track.id)).toEqual([
            'folder-starter-stems',
            'track-kick',
            'track-vocal',
        ]);
        expect(mocks.promoteStagedAsset).toHaveBeenCalledTimes(2);
        expect(mocks.promoteStagedAsset).toHaveBeenCalledWith('lease-kick');
        expect(mocks.promoteStagedAsset).toHaveBeenCalledWith('lease-vocal');

        await undo();

        expect(requireTrackState().tracks).toEqual([]);
        expect(mocks.promoteStagedAsset).toHaveBeenCalledTimes(2);
        expect(mocks.publishTrackRemoved).toHaveBeenCalledTimes(3);
    });

    it('rejects guarded compensation after generated project truth diverges', async () => {
        const action = createStemImportAction();
        const inverse = await applyStemImport(action);
        const state = requireTrackState();

        trackStore.set({
            ...state,
            tracks: [
                ...state.tracks,
                TrackDummy.create({ id: 'collab-child', parentId: action.payload.folderId, clips: [] }),
            ],
        });

        expect(handleDiscardImportedStemSet.canReapplyAfterDivergence?.(inverse)).toBe(false);
        expect(validateDiscard(inverse)).toBe(false);
        expect(await handleDiscardImportedStemSet.execute(inverse)).toEqual({ status: 'conflict' });
        expect(requireTrackState().tracks.map((track) => track.id)).toEqual([
            'folder-starter-stems',
            'track-kick',
            'track-vocal',
            'collab-child',
        ]);
    });

    it('rejects guarded compensation after generated clip resources diverge', async () => {
        const action = createStemImportAction();
        const inverse = await applyStemImport(action);
        const midiState = requireMidiState();

        setMidiStoreState({
            ...midiState,
            notesByClipId: {
                ...midiState.notesByClipId,
                'clip-kick': [{ id: 'collab-note', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
        });

        expect(handleDiscardImportedStemSet.canReapplyAfterDivergence?.(inverse)).toBe(false);
        expect(validateDiscard(inverse)).toBe(false);
        expect(await handleDiscardImportedStemSet.execute(inverse)).toEqual({ status: 'conflict' });
        expect(requireTrackState().tracks.map((track) => track.id)).toEqual([
            'folder-starter-stems',
            'track-kick',
            'track-vocal',
        ]);
        expect(requireMidiState().notesByClipId).toHaveProperty('clip-kick');
    });
});
