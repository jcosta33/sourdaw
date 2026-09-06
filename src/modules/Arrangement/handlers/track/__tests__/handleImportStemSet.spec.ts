import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { automationStore, type AutomationStoreState } from '#/modules/Automation/stores';
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
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { LEGACY_MIDI_PROBABILITY_SEED, midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import { setMidiStoreState } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { handleDiscardImportedStemSet, handleImportStemSet } from '../handleImportStemSet';

const mocks = vi.hoisted(() => ({
    activateExternalPlugin: vi.fn<() => void>(),
    initializeTrackStripFromSnapshot: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    promoteDurableStagedAsset: vi.fn(),
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
    analyzePitchForClip: vi.fn(),
    applyNoteExpression: vi.fn(),
    audioEngine: {},
    createRuntimeGraphTopologyFingerprint: vi.fn(),
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    getLiveEngineSampleRate: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));
vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: () => ({
        promoteDurableStagedAsset: mocks.promoteDurableStagedAsset,
        promoteStagedAsset: mocks.promoteStagedAsset,
    }),
}));
vi.mock('#/modules/PluginHost/useCases', () => ({
    activateExternalPlugin: mocks.activateExternalPlugin,
    registerFaustDSP: vi.fn(),
}));
vi.mock('#/modules/Routing/useCases', () => ({
    getAllSidechainRoutes: () => [],
    removeSidechainRoute: () => null,
    setSend: mocks.setSend,
    wireSidechainRoutes: mocks.wireSidechainRoutes,
    hydrateSidechainRoutes: vi.fn(),
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readAuthoritativeProjectTruth(): Record<'tracks' | 'midi' | 'automation', unknown> {
    const document = getCrdtDoc<Record<string, unknown>>('root');
    if (!document) {
        throw new Error('Expected root CRDT document');
    }
    const parsed: unknown = JSON.parse(JSON.stringify(document));
    if (!isRecord(parsed)) {
        throw new Error('Expected serializable root CRDT document');
    }
    for (const slot of ['tracks', 'midi', 'automation'] as const) {
        if (!Object.hasOwn(parsed, slot)) {
            throw new Error(`Expected authoritative ${slot} slot`);
        }
    }
    return {
        tracks: parsed.tracks,
        midi: parsed.midi,
        automation: parsed.automation,
    };
}

function expectSeededAuthoritativeProjectTruth(truth: Record<'tracks' | 'midi' | 'automation', unknown>): void {
    expect(truth).toMatchObject({
        tracks: {
            tracks: [
                {
                    id: 'track-existing-midi',
                    clips: [{ id: 'clip-existing-midi', trackId: 'track-existing-midi', type: 'midi' }],
                },
            ],
        },
        midi: {
            notesByClipId: { 'clip-existing-midi': [{ id: 'note-existing-midi' }] },
            ccByClipId: { 'clip-existing-midi': [{ id: 'cc-existing-midi' }] },
            pitchBendByClipId: { 'clip-existing-midi': [{ id: 'bend-existing-midi' }] },
        },
        automation: {
            lanes: [
                {
                    id: 'automation-existing-midi-volume',
                    trackId: 'track-existing-midi',
                    clipId: 'clip-existing-midi',
                    points: [{ id: 'point-existing-midi' }],
                },
            ],
        },
    });
}

function seedUnrelatedProjectTruth(): void {
    const clip = ClipDummy.create({
        id: 'clip-existing-midi',
        trackId: 'track-existing-midi',
        name: 'Existing MIDI',
        type: 'midi',
        audioBufferId: undefined,
    });
    const track = TrackDummy.create({
        id: 'track-existing-midi',
        name: 'Existing MIDI',
        kind: 'midi',
        clips: [clip],
    });
    const automation: AutomationStoreState = {
        lanes: [
            {
                id: 'automation-existing-midi-volume',
                trackId: track.id,
                clipId: clip.id,
                parameterId: 'volume',
                parameterName: 'Volume',
                points: [{ id: 'point-existing-midi', beat: 1, value: 0.75, curve: 'linear', tension: 0 }],
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 1,
            },
        ],
    };

    const seedTransaction = runWithAutomergeStorageTransaction(undefined, () => {
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        setMidiStoreState({
            ...emptyMidiStoreState,
            notesByClipId: {
                [clip.id]: [{ id: 'note-existing-midi', pitch: 64, startBeat: 1, duration: 2, velocity: 96 }],
            },
            ccByClipId: {
                [clip.id]: [{ id: 'cc-existing-midi', controller: 1, value: 0.5, beat: 1, channel: 0 }],
            },
            pitchBendByClipId: {
                [clip.id]: [{ id: 'bend-existing-midi', value: 0.25, beat: 1, channel: 0 }],
            },
        });
        automationStore.set(automation);
    });
    if (seedTransaction.status !== 'returned') {
        throw seedTransaction.error;
    }
    seedTransaction.commit();
}

describe('handleImportStemSet', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.promoteDurableStagedAsset.mockImplementation(async (leaseId: string, hash: string) => ({
            status: 'promoted',
            leaseId,
            hash,
        }));
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
        automationStore.set({ lanes: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        setMidiStoreState(emptyMidiStoreState);
        automationStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('admits a guarded stem import into an atomic batch and undo executes the inverse exactly', async () => {
        seedUnrelatedProjectTruth();
        const preImportTruth = {
            tracks: structuredClone(requireTrackState()),
            midi: structuredClone(requireMidiState()),
            automation: structuredClone(automationStore.value),
        };
        const preImportDocumentTruth = readAuthoritativeProjectTruth();
        expectSeededAuthoritativeProjectTruth(preImportDocumentTruth);
        const action = createStemImportAction();
        const preApplyInverse = describeImportInverse(action);

        expect(handleDiscardImportedStemSet.canReapplyAfterDivergence?.(preApplyInverse)).toBe(true);

        const result = await executeAppActionBatch([action], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(result).toMatchObject({ status: 'committed' });
        expect(requireTrackState().tracks.map((track) => track.id)).toEqual([
            'track-existing-midi',
            'folder-starter-stems',
            'track-kick',
            'track-vocal',
        ]);
        expect(mocks.promoteDurableStagedAsset).toHaveBeenCalledTimes(2);
        expect(mocks.promoteDurableStagedAsset).toHaveBeenCalledWith('lease-kick', 'hash-kick');
        expect(mocks.promoteDurableStagedAsset).toHaveBeenCalledWith('lease-vocal', 'hash-vocal');
        expect(mocks.promoteStagedAsset).not.toHaveBeenCalled();

        await undo();

        expect(readAuthoritativeProjectTruth()).toEqual(preImportDocumentTruth);
        expect(requireTrackState()).toEqual(preImportTruth.tracks);
        expect(requireMidiState()).toEqual(preImportTruth.midi);
        expect(automationStore.value).toEqual(preImportTruth.automation);
        expect(mocks.promoteDurableStagedAsset).toHaveBeenCalledTimes(2);
        expect(mocks.publishTrackRemoved).toHaveBeenCalledTimes(3);
    });

    it('retries an incomplete hash-bound durable promotion', async () => {
        const action = createStemImportAction();
        action.payload.stems = [action.payload.stems[0]!];
        const result = await handleImportStemSet.execute(action);

        mocks.promoteDurableStagedAsset
            .mockResolvedValueOnce({ status: 'failed', reason: 'lease-hash-mismatch' })
            .mockResolvedValue({ status: 'promoted', leaseId: 'lease-kick', hash: 'hash-kick' });

        await expect(result?.afterCommit?.()).rejects.toThrow('lease-hash-mismatch');
        await expect(result?.afterCommit?.()).resolves.toBeUndefined();

        expect(mocks.promoteDurableStagedAsset).toHaveBeenCalledTimes(2);
        expect(mocks.promoteDurableStagedAsset).toHaveBeenNthCalledWith(1, 'lease-kick', 'hash-kick');
        expect(mocks.promoteDurableStagedAsset).toHaveBeenNthCalledWith(2, 'lease-kick', 'hash-kick');
        expect(mocks.promoteStagedAsset).not.toHaveBeenCalled();
    });

    it('declares manual repair when both post-commit attempts cannot prove exact recovery', async () => {
        const result = await handleImportStemSet.execute(createStemImportAction());

        expect(result).toMatchObject({
            status: 'written',
            postCommitEffect: { kind: 'external-effect', remediation: 'manual-repair' },
        });
    });

    it('commits stem import once and preserves a manual-repair pending effect when both deferred attempts fail', async () => {
        const document: Record<string, unknown> = {};
        let projectCommitCount = 0;
        const action = createStemImportAction();
        const onProjectCommitPrepared = vi.fn();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                changeFn(document);
                projectCommitCount += 1;
            },
        });
        mocks.promoteDurableStagedAsset.mockResolvedValue({ status: 'failed', reason: 'asset promotion unavailable' });

        const result = await executeAppActionBatch([action], { onProjectCommitPrepared });

        expect(requireTrackState().tracks.map((track) => track.id)).toEqual([
            'folder-starter-stems',
            'track-kick',
            'track-vocal',
        ]);
        expect(document).toMatchObject({
            tracks: {
                tracks: [{ id: 'folder-starter-stems' }, { id: 'track-kick' }, { id: 'track-vocal' }],
            },
        });
        expect(projectCommitCount).toBe(1);
        expect(mocks.promoteDurableStagedAsset).toHaveBeenCalledTimes(4);
        expect(result).toMatchObject({
            status: 'committed-with-warning',
            warningDetails: [
                {
                    kind: 'external-effect',
                    pendingEffect: { kind: 'external-effect', remediation: 'manual-repair', state: 'pending' },
                },
            ],
        });
        expect(onProjectCommitPrepared).toHaveBeenCalledWith(
            expect.objectContaining({
                pendingEffects: [
                    expect.objectContaining({
                        kind: 'external-effect',
                        remediation: 'manual-repair',
                        state: 'pending',
                    }),
                ],
            })
        );
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
