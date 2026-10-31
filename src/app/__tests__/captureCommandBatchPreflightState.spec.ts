import { change, from } from '@automerge/automerge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type getProjectContext } from '#/modules/AiRuntime/useCases';
import {
    commandBatchPreflightPort,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';

import { captureCommandBatchPreflightState } from '../captureCommandBatchPreflightState';

const mocks = vi.hoisted(() => {
    const agentProjectRepairStateStore: { value: unknown } = { value: null };
    return {
        agentProjectRepairStateStore,
        captureProjectIdentity: vi.fn(() => 'document-identity-a'),
        captureProjectRevision: vi.fn(() => 'document-identity-a'),
        getAssetTransfer: vi.fn(),
        getCrdtDoc: vi.fn<(id: string) => unknown>(),
        getProjectContext: vi.fn(),
        hasAudioBuffer: vi.fn<(id: string) => boolean>(),
        trackStore: { value: { tracks: [] } },
    };
});

vi.mock('#/modules/AiRuntime/useCases', () => ({
    getProjectContext: mocks.getProjectContext,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    getTrackEligibility: vi.fn(),
    readMusicalRangeInputs: vi.fn(() => []),
    readMusicalRange: vi.fn(),
    clipHasActiveGainEnvelope: vi.fn(),
    getGainEnvelopeSeries: vi.fn(),
    gainEnvelopeStore: { value: { envelopes: {} }, subscribe: vi.fn() },
    trackStore: mocks.trackStore,
    resolveEligibleClipWriteTarget: vi.fn<typeof import('#/modules/Arrangement/stores').resolveEligibleClipWriteTarget>(
        () => ({ status: 'ineligible' })
    ),
    adjustmentLayerStore: { value: { layers: [] }, subscribe: vi.fn() },
    takeLaneStore: { value: { lanes: [] }, subscribe: vi.fn() },
    vcaGroupStore: { value: { groups: [] }, subscribe: vi.fn(() => () => {}) },
    deriveVcaMultiplier: vi.fn(() => 1),
    getVcaGroupsState: vi.fn(() => ({})),
    shouldCreateLiveTrackStrip: vi.fn(() => false),
    deriveEffectiveAudibility: vi.fn(() => true),
    warpStates: new Map(),
    getWarpState: vi.fn(),
    addWarpMarker: vi.fn(),
    setWarpState: vi.fn(),
    getStoredWarpState: vi.fn(),
    warpStateStore: { value: { states: {} }, subscribe: vi.fn() },
    clampDeviceParamWrite: vi.fn(),
    // A barrel factory replaces the whole module, so every member anything in
    // this spec's graph imports has to be present here — Automation's range
    // handlers reach both of these, and neither is exercised by these cases.
    markerStore: { value: null, subscribe: vi.fn() },
    resolveEligibleDeviceWriteTarget: vi.fn(() => null),
    clipSelectionStore: { value: null, subscribe: vi.fn(() => () => {}) },
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { has: mocks.hasAudioBuffer },
}));

vi.mock('#/modules/Collaboration/useCases', () => ({
    getAssetTransfer: mocks.getAssetTransfer,
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: mocks.agentProjectRepairStateStore,
    actionHistoryStore: { value: { entries: [] as unknown[] }, subscribe: vi.fn() },
    setSemanticContext: vi.fn(),
    clearSemanticContext: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectIdentity: mocks.captureProjectIdentity,
    captureProjectRevision: mocks.captureProjectRevision,
    DOC_PREFIX_ROOT: 'root',
    getCrdtDoc: mocks.getCrdtDoc,
}));

function projectContext(): ReturnType<typeof getProjectContext> {
    return {
        tempo: 120,
        timeSignature: [4, 4],
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        loopStart: 0,
        loopEnd: 4,
        punchInEnabled: false,
        punchInBeat: 0,
        punchOutBeat: 4,
        metronomeEnabled: false,
        metronomeVolume: 0.8,
        masterGain: 1,
        tracks: [
            {
                id: 'track-vocal',
                name: 'Vocal',
                kind: 'audio',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                frozen: false,
                gain: 1,
                pan: 0,
                automationMode: 'read',
                outputId: 'bus-vocal',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
                sends: [],
            },
            {
                id: 'bus-vocal',
                name: 'Vocal Bus',
                kind: 'bus',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                frozen: false,
                gain: 1,
                pan: 0,
                automationMode: 'read',
                outputId: 'master',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
                sends: [],
            },
            {
                id: 'master',
                name: 'Master',
                kind: 'master',
                muted: false,
                soloed: false,
                soloSafe: false,
                armed: false,
                frozen: false,
                gain: 1,
                pan: 0,
                automationMode: 'read',
                outputId: 'hw_out',
                clipCount: 0,
                deviceCount: 0,
                clips: [],
                devices: [],
                sends: [],
            },
        ],
        selectedTrackId: null,
        selectedClipId: null,
        selectedClipIds: [],
        activeView: 'arrange',
        playheadPosition: 0,
    };
}

// Root document whose bus routing cycles: bus-vocal outputs to bus-master, which
// outputs back to bus-vocal. Every other field is invariant-clean so a rejection
// can only come from the audio-graph verdict itself.
function cyclingRootDocument(): Record<string, unknown> {
    return {
        tracks: {
            tracks: [
                {
                    id: 'track-vocal',
                    kind: 'audio',
                    gain: 1,
                    pan: 0,
                    outputId: 'bus-vocal',
                    clips: [],
                    devices: [],
                    sends: [],
                },
                {
                    id: 'bus-vocal',
                    kind: 'bus',
                    gain: 1,
                    pan: 0,
                    outputId: 'bus-master',
                    clips: [],
                    devices: [],
                    sends: [],
                },
                {
                    id: 'bus-master',
                    kind: 'bus',
                    gain: 1,
                    pan: 0,
                    outputId: 'bus-vocal',
                    clips: [],
                    devices: [],
                    sends: [],
                },
            ],
        },
    };
}

function midiRows(noteIds: readonly string[] = ['note-1']) {
    return {
        notes: noteIds.map((id) => ({ id, pitch: 60, startBeat: 0, duration: 1, velocity: 100 })),
        controlChanges: [{ id: 'cc-1', controller: 1, value: 64, beat: 0, channel: 0 }],
        pitchBends: [{ id: 'bend-1', value: 0, beat: 0, channel: 0 }],
    };
}

// The exact frozen copy a re-key captures: the original clip's rows, ids included.
function midiTakeSource(noteIds: readonly string[] = ['note-1']) {
    const rows = midiRows(noteIds);
    return {
        sourceClipId: 'clip-a',
        rows: {
            notes: { present: true, value: rows.notes },
            controlChanges: { present: true, value: rows.controlChanges },
            pitchBends: { present: true, value: rows.pitchBends },
        },
        sourceEntryBeat: 0,
        sourceEndBeat: 4,
        phaseHeadBeat: 0,
        passLengthBeats: 4,
    };
}

type MidiTakeFixtureOptions = {
    liveNoteIds?: readonly string[];
    sourceNoteIds?: readonly string[];
    secondTakeId?: string;
    secondClipId?: string;
};

// A MIDI clip fragmented into clip-a and clip-b, each fragment's take carrying
// the same frozen source of the original rows that clip-a still holds live.
function midiTakeProjectSlots(options: MidiTakeFixtureOptions = {}): Record<string, unknown> {
    const rows = midiRows(options.liveNoteIds);
    return {
        tracks: {
            tracks: [
                {
                    id: 'track-keys',
                    kind: 'midi',
                    gain: 1,
                    pan: 0,
                    outputId: 'master',
                    clips: [
                        { id: 'clip-a', startBeat: 0, endBeat: 2 },
                        { id: options.secondClipId ?? 'clip-b', startBeat: 2, endBeat: 4 },
                    ],
                    devices: [],
                    sends: [],
                },
            ],
        },
        midi: {
            notesByClipId: { 'clip-a': rows.notes },
            ccByClipId: { 'clip-a': rows.controlChanges },
            pitchBendByClipId: { 'clip-a': rows.pitchBends },
        },
        takeLanes: {
            lanes: [
                {
                    id: 'lane-keys',
                    trackId: 'track-keys',
                    takes: [
                        {
                            id: 'take-1',
                            clipId: 'clip-a',
                            name: 'Take 1',
                            startBeat: 0,
                            endBeat: 2,
                            selected: true,
                            midiSource: midiTakeSource(options.sourceNoteIds),
                        },
                        {
                            id: options.secondTakeId ?? 'take-2',
                            clipId: 'clip-b',
                            name: 'Take 2',
                            startBeat: 2,
                            endBeat: 4,
                            selected: false,
                            midiSource: midiTakeSource(options.sourceNoteIds),
                        },
                    ],
                    activeCompRegions: [
                        { startBeat: 0, endBeat: 2, takeId: 'take-1' },
                        { startBeat: 2, endBeat: 4, takeId: options.secondTakeId ?? 'take-2' },
                    ],
                },
            ],
        },
    };
}

/** Inspects the document from inside a real Automerge change, where command
 *  postcondition validation runs and every row is a document proxy. */
function inspectInsideDocumentChange(document: Record<string, unknown>) {
    let inspected: ReturnType<typeof captureCommandBatchPreflightState> | undefined;
    change(from(document), (draft) => {
        inspected = captureCommandBatchPreflightState({ assetReferences: [], projectDocument: draft, targetIds: [] });
    });
    if (!inspected) {
        throw new Error('The in-change inspection did not run');
    }
    return inspected;
}

function midiTakeArrangementDocument(snapshotExtras: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        arrangements: {
            activeArrangementId: 'arrangement-1',
            arrangements: [{ id: 'arrangement-1', name: 'Main', ...midiTakeProjectSlots(), ...snapshotExtras }],
        },
        tracks: { tracks: [] },
    };
}

// The beforeEach root document plus one clip, so slot copies can collide with
// a live track or clip id.
function rootDocumentWith(slots: Record<string, unknown>): Record<string, unknown> {
    const route = (id: string, kind: string, outputId: string, clips: unknown[] = []) => ({
        id,
        kind,
        gain: 1,
        pan: 0,
        outputId,
        clips,
        devices: [],
        sends: [],
    });
    return {
        tracks: {
            tracks: [
                route('track-vocal', 'audio', 'bus-vocal', [{ id: 'clip-vocal', startBeat: 0, endBeat: 4 }]),
                route('bus-vocal', 'bus', 'master'),
                route('master', 'master', 'hw_out'),
            ],
        },
        ...slots,
    };
}

function arrangementsSlot(arrangementIds: readonly string[]): Record<string, unknown> {
    return {
        activeArrangementId: arrangementIds[0],
        arrangements: arrangementIds.map((id) => ({ id, tracks: rootDocumentWith({}).tracks })),
    };
}

function clipEnvelope(clipId: string, pointIds: readonly string[]): Record<string, unknown> {
    return {
        clipId,
        enabled: true,
        points: pointIds.map((id, index) => ({ id, beatOffset: index, gainDb: -6 })),
    };
}

function chordEvent(id: string): Record<string, unknown> {
    return { id, beat: 0, root: 0, quality: 'major', duration: 4 };
}

// The chord slot's CRDT encoding: live events keyed by id beside the
// `migrationBase` copy the store writes on the slot's first write.
function chordTrackSlot(liveIds: readonly string[], baseIds: readonly string[]): Record<string, unknown> {
    return {
        schemaVersion: 1,
        enabled: true,
        events: Object.fromEntries(liveIds.map((id) => [id, { deleted: false, value: chordEvent(id) }])),
        migrationBase: { enabled: true, events: baseIds.map(chordEvent) },
    };
}

describe('captureCommandBatchPreflightState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.agentProjectRepairStateStore.value = null;
        mocks.captureProjectIdentity.mockReturnValue('document-identity-a');
        mocks.captureProjectRevision.mockReturnValue('document-identity-a');
        mocks.getProjectContext.mockReturnValue(projectContext());
        mocks.getCrdtDoc.mockReturnValue({
            tracks: {
                tracks: [
                    {
                        id: 'track-vocal',
                        kind: 'audio',
                        gain: 1,
                        pan: 0,
                        outputId: 'bus-vocal',
                        clips: [],
                        devices: [],
                        sends: [],
                    },
                    {
                        id: 'bus-vocal',
                        kind: 'bus',
                        gain: 1,
                        pan: 0,
                        outputId: 'master',
                        clips: [],
                        devices: [],
                        sends: [],
                    },
                    {
                        id: 'master',
                        kind: 'master',
                        gain: 1,
                        pan: 0,
                        outputId: 'hw_out',
                        clips: [],
                        devices: [],
                        sends: [],
                    },
                ],
            },
        });
        mocks.hasAudioBuffer.mockImplementation((id) => id === 'buffer-vocal');
        mocks.getAssetTransfer.mockReturnValue({ hasAsset: (hash: string) => hash === 'sha256:vocal' });
    });

    it('captures authoritative targets, assets, invariants, and routing validity', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [{ assetHash: 'sha256:vocal', audioBufferId: 'buffer-vocal' }],
            targetIds: ['track-vocal', 'hw_out'],
        });

        expect(state).toMatchObject({
            audioGraphValid: true,
            availableAssetHashes: ['sha256:vocal'],
            availableAudioBufferIds: ['buffer-vocal'],
            lockedRanges: [],
            projectId: 'document-identity-a',
            projectInvariantsValid: true,
            targetFingerprints: {
                hw_out: 'system-output:hw_out',
            },
        });
        expect(state.targetFingerprints['track-vocal']).toContain('track-vocal');
    });

    it('captures device parameters by plain and device-qualified target identity', () => {
        mocks.getCrdtDoc.mockReturnValue({
            tracks: [
                {
                    id: 'track-bass-di',
                    devices: [
                        {
                            id: 'device-compressor',
                            parameterValues: {
                                'comp-attack': 12,
                                'comp-threshold': -24,
                            },
                        },
                    ],
                },
            ],
        });

        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            targetIds: ['comp-threshold', 'device-compressor:comp-attack'],
        });

        expect(state.targetFingerprints['comp-threshold']).toBe(
            JSON.stringify([
                JSON.stringify({ deviceId: 'device-compressor', parameterId: 'comp-threshold', value: -24 }),
            ])
        );
        expect(state.targetFingerprints['device-compressor:comp-attack']).toBe(
            JSON.stringify([JSON.stringify({ deviceId: 'device-compressor', parameterId: 'comp-attack', value: 12 })])
        );
    });

    it('does not let projection-only tracks, devices, or layers establish writable target authority', () => {
        const context = projectContext();
        context.tracks[0] = {
            ...context.tracks[0]!,
            id: 'track-projection-only',
            devices: [
                {
                    id: 'device-projection-only',
                    name: 'Projection Compressor',
                    type: 'builtin-compressor',
                    bypassed: false,
                },
            ],
        };
        context.adjustmentLayers = [
            {
                id: 'layer-projection-only',
                name: 'Projection EQ',
                effectType: 'eq',
                parameters: [],
                affectedTrackIds: ['track-projection-only'],
                insertionIndex: 0,
                regions: [],
                enabled: true,
                mix: 1,
                color: '#ffffff',
            },
        ];
        mocks.getProjectContext.mockReturnValue(context);

        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: { tracks: { tracks: [] } },
            targetIds: ['track-projection-only', 'device-projection-only', 'layer-projection-only'],
        });

        expect(state.targetFingerprints).toEqual({});
        expect(state.advertisedTargetFingerprints).toEqual({});
    });

    it('fails targets-exist when the requested target exists only in the live projection', async () => {
        const context = projectContext();
        context.tracks[0] = { ...context.tracks[0]!, id: 'track-projection-only' };
        mocks.getProjectContext.mockReturnValue(context);
        mocks.getCrdtDoc.mockReturnValue({ tracks: { tracks: [] } });
        commandBatchPreflightPort.setProvider(captureCommandBatchPreflightState);
        const command = createVersionedCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-projection-only', gain: 0.8, expectedGain: 1 },
            },
            availableDeviceVersions: {},
            expectedEffect: 'Set the projected track gain.',
            normalizedProjectRevision: 'document-identity-a',
            objectReferences: [{ argument: 'trackId', id: 'track-projection-only', scope: 'stable' }],
            parameterUnits: [
                { argument: 'gain', unit: 'linear-gain' },
                { argument: 'expectedGain', unit: 'linear-gain' },
            ],
            reason: 'Prove projection state cannot authorize a write.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: 'document-identity-a',
            batchId: 'batch-projection-only',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Attempt a projection-only write',
            mode: 'preview',
            projectId: 'document-identity-a',
            runId: 'run-projection-only',
        });

        try {
            const result = await executeVersionedCommandBatchEnvelope({
                authority: batch.authority,
                serialized: batch.serialized,
            });

            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Command batch target does not exist: track-projection-only',
                actions: [],
            });
        } finally {
            commandBatchPreflightPort.setProvider(null);
        }
    });

    it('does not let a stored arrangement copy establish authority for a target the live project lost', () => {
        const storedTrack = {
            clips: [],
            devices: [{ id: 'device-drive', parameterValues: { drive: 0.4 } }],
            id: 'track-drive',
        };
        mocks.getCrdtDoc.mockReturnValue({
            arrangements: {
                activeArrangementId: 'arrangement-1',
                arrangements: [{ id: 'arrangement-1', tracks: { tracks: [storedTrack] } }],
            },
            tracks: { tracks: [{ ...storedTrack, devices: [] }] },
        });

        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            targetIds: ['track-drive', 'device-drive', 'device-drive:drive'],
        });

        expect(Object.keys(state.targetFingerprints)).toEqual(['track-drive']);
    });

    it('reports advertised drift for a document-backed target without moving its document fingerprint', () => {
        const document = {
            tracks: {
                tracks: [
                    {
                        id: 'track-vocal',
                        kind: 'audio',
                        gain: 1,
                        pan: 0,
                        outputId: 'master',
                        clips: [],
                        devices: [],
                        sends: [],
                    },
                ],
            },
        };
        const approved = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: document,
            targetIds: ['track-vocal'],
        });
        const driftedContext = projectContext();
        driftedContext.tracks[0] = { ...driftedContext.tracks[0]!, gain: 0.25 };
        mocks.getProjectContext.mockReturnValue(driftedContext);

        const drifted = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: document,
            targetIds: ['track-vocal'],
        });

        expect(approved.targetFingerprints['track-vocal']).toContain('track-vocal');
        expect(drifted.targetFingerprints['track-vocal']).toBe(approved.targetFingerprints['track-vocal']);
        expect(approved.advertisedTargetFingerprints['track-vocal']).toBeDefined();
        expect(drifted.advertisedTargetFingerprints['track-vocal']).not.toBe(
            approved.advertisedTargetFingerprints['track-vocal']
        );
    });

    it('captures an adjustment layer from its document-owned slot', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                adjustmentLayers: {
                    layers: [
                        {
                            id: 'layer-bass-eq',
                            name: 'Bass EQ',
                            effectType: 'eq',
                            parameters: [],
                            affectedTrackIds: ['track-bass'],
                            insertionIndex: 0,
                            regions: [],
                            enabled: true,
                            mix: 0.8,
                            color: '#ffffff',
                        },
                    ],
                },
                tracks: {
                    tracks: [
                        {
                            id: 'track-bass',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
            },
            targetIds: ['layer-bass-eq'],
        });

        expect(state.targetFingerprints['layer-bass-eq']).toContain('Bass EQ');
    });

    it('prefers a real master identity while keeping output fallbacks system-scoped', () => {
        const realMaster = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'master',
                            name: 'Document Master',
                            kind: 'master',
                            gain: 0.73,
                            pan: 0,
                            outputId: 'hw_out',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
            },
            targetIds: ['master', 'hw_out'],
        });
        const fallbacks = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: { tracks: { tracks: [] } },
            targetIds: ['master', 'hw_out', 'track-projection-only'],
        });

        expect(realMaster.targetFingerprints.master).toContain('Document Master');
        expect(realMaster.targetFingerprints.master).not.toBe('system-output:master');
        expect(realMaster.targetFingerprints.hw_out).toBe('system-output:hw_out');
        expect(fallbacks.targetFingerprints).toEqual({
            master: 'system-output:master',
            hw_out: 'system-output:hw_out',
        });
    });

    it('reports a cycle already present in the complete routing graph', () => {
        const context = projectContext();
        context.tracks[1]!.outputId = 'track-vocal';
        mocks.getProjectContext.mockReturnValue(context);

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.audioGraphValid).toBe(false);
    });

    it('rejects the live path when the root document carries a cycle the store has not projected yet', () => {
        // The store projection still holds the pre-cycle graph: track-vocal -> bus-vocal -> master.
        mocks.getCrdtDoc.mockReturnValue(cyclingRootDocument());

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(true);
        expect(state.audioGraphValid).toBe(false);
    });

    it('rejects a cycling document during repair even though no projection is available', () => {
        mocks.agentProjectRepairStateStore.value = { status: 'repair-required' };
        mocks.getCrdtDoc.mockReturnValue(cyclingRootDocument());

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.audioGraphValid).toBe(false);
    });

    it('keeps the document-backed graph verdict when store and document agree on every path', () => {
        const live = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });
        const staged = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: mocks.getCrdtDoc('root') as Readonly<Record<string, unknown>>,
            targetIds: [],
        });
        mocks.agentProjectRepairStateStore.value = { status: 'repair-required' };
        const duringRepair = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(live.audioGraphValid).toBe(true);
        expect(staged.audioGraphValid).toBe(true);
        expect(duringRepair.audioGraphValid).toBe(true);
    });

    it('binds projectId to the document identity, independently of the revision it commits against', () => {
        const first = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });
        // projectId answers "same project"; it must stay put across an ordinary revision move so an
        // unrelated edit between an AI proposal and its confirm does not read as a different project.
        mocks.captureProjectRevision.mockReturnValue('document-identity-b');

        const stableAcrossRevision = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(first.projectId).toBe('document-identity-a');
        expect(stableAcrossRevision.projectId).toBe('document-identity-a');

        mocks.captureProjectIdentity.mockReturnValue('document-identity-c');
        const afterProjectReplacement = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(afterProjectReplacement.projectId).toBe('document-identity-c');
    });

    it('captures targets and routing from the staged root document when supplied', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'track-vocal',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'bus-vocal',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                        {
                            id: 'bus-vocal',
                            kind: 'bus',
                            gain: 1,
                            pan: 0,
                            outputId: 'track-vocal',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                        {
                            id: 'track-created',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
            },
            targetIds: ['track-created'],
        });

        expect(state.targetFingerprints['track-created']).toContain('track-created');
        expect(state.projectInvariantsValid).toBe(true);
        expect(state.audioGraphValid).toBe(false);
    });

    it('rejects invalid raw transport truth instead of validating its sanitized projection', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'track-vocal',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
                transport: { tempo: Number.POSITIVE_INFINITY },
            },
            targetIds: [],
        });

        expect(state).toMatchObject({ audioGraphValid: false, projectInvariantsValid: false });
    });

    it('validates staged raw truth without exposing projected model context during repair', () => {
        mocks.agentProjectRepairStateStore.value = { status: 'repair-required' };

        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            clips: [],
                            devices: [],
                            gain: 1,
                            id: 'master',
                            kind: 'master',
                            outputId: null,
                            pan: 0,
                            sends: [],
                        },
                    ],
                },
                transport: { tempo: 120 },
            },
            targetIds: ['master'],
        });

        expect(mocks.getProjectContext).not.toHaveBeenCalled();
        expect(state).toMatchObject({ audioGraphValid: true, projectInvariantsValid: true });
    });

    it('rejects a staged output target that cannot compile to an audio node', () => {
        const state = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'track-vocal',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'folder-vocals',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                        {
                            id: 'folder-vocals',
                            kind: 'folder',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
            },
            targetIds: [],
        });

        expect(state.projectInvariantsValid).toBe(true);
        expect(state.audioGraphValid).toBe(false);
    });

    it('accepts nodeless VCA tracks in live and staged graph compilation', () => {
        const context = projectContext();
        context.tracks.push({
            ...context.tracks[0]!,
            id: 'vca-drums',
            name: 'Drum VCA',
            kind: 'vca',
            outputId: 'master',
        });
        mocks.getProjectContext.mockReturnValue(context);

        const live = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });
        const staged = captureCommandBatchPreflightState({
            assetReferences: [],
            projectDocument: {
                tracks: {
                    tracks: [
                        {
                            id: 'track-vocal',
                            kind: 'audio',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                        {
                            id: 'vca-drums',
                            kind: 'vca',
                            gain: 1,
                            pan: 0,
                            outputId: 'master',
                            clips: [],
                            devices: [],
                            sends: [],
                        },
                    ],
                },
            },
            targetIds: [],
        });

        expect(live.audioGraphValid).toBe(true);
        expect(staged).toMatchObject({ audioGraphValid: true, projectInvariantsValid: true });
    });

    it('admits warp states whose clips share marker ids, the deliberate copy contract', () => {
        // Warp-marker identity is clip-local (#5570): duplication, paste and
        // Strip Silence copy marker ids into independent states, so the
        // duplicate scan validates each clip's state in its own namespace
        // instead of counting the shared ids globally.
        mocks.getCrdtDoc.mockReturnValue({
            tracks: { tracks: [] },
            warpStates: {
                states: {
                    'clip-a': { markers: [{ id: 'm-1' }] },
                    'clip-b': { markers: [{ id: 'm-1' }, { id: 'm-2' }] },
                },
            },
        });

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(true);
    });

    it('still fails a marker id repeated inside one clip warp state', () => {
        mocks.getCrdtDoc.mockReturnValue({
            tracks: { tracks: [] },
            warpStates: {
                states: {
                    'clip-a': { markers: [{ id: 'm-1' }, { id: 'm-1' }] },
                },
            },
        });

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('admits frozen MIDI take sources that copy the live row ids, the exact-original-rows contract', () => {
        // A re-key (Delete Time, split) freezes the clip's original rows, ids
        // included, on every fragment's take, so those ids repeat the live rows
        // and each other by design.
        mocks.getCrdtDoc.mockReturnValue(midiTakeProjectSlots());

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state).toMatchObject({ audioGraphValid: true, projectInvariantsValid: true });
    });

    it('admits frozen MIDI take sources copying row ids inside one arrangement snapshot', () => {
        mocks.getCrdtDoc.mockReturnValue(midiTakeArrangementDocument());

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(true);
    });

    // Inside a change every list read returns a fresh proxy, so each declared
    // scope must hold by where it sits, not by which object it is.
    it.each([
        {
            scope: 'arrangement snapshots copying the live track and clip ids',
            document: () => rootDocumentWith({ arrangements: arrangementsSlot(['arrangement-1', 'arrangement-2']) }),
        },
        {
            scope: 'gain points shared across two clip envelopes',
            document: () =>
                rootDocumentWith({
                    gainEnvelopes: {
                        envelopes: {
                            'clip-vocal': clipEnvelope('clip-vocal', ['point-1']),
                            'clip-copy': clipEnvelope('clip-copy', ['point-1']),
                        },
                    },
                }),
        },
        { scope: 'frozen MIDI take sources copying the live row ids', document: () => midiTakeProjectSlots() },
        {
            scope: 'frozen MIDI take sources copying row ids inside an arrangement snapshot',
            document: () => midiTakeArrangementDocument(),
        },
    ])('admits $scope inside a document change', ({ document }) => {
        const state = inspectInsideDocumentChange(document());

        expect(state).toMatchObject({ audioGraphValid: true, projectInvariantsValid: true });
    });

    it.each([
        {
            scope: 'two arrangement snapshots under one arrangement id',
            document: () => rootDocumentWith({ arrangements: arrangementsSlot(['arrangement-1', 'arrangement-1']) }),
        },
        {
            scope: 'an id repeated inside one arrangement snapshot',
            document: () =>
                rootDocumentWith({
                    arrangements: {
                        activeArrangementId: 'arrangement-1',
                        arrangements: [
                            { id: 'arrangement-1', tracks: { tracks: [{ id: 'track-a' }, { id: 'track-a' }] } },
                        ],
                    },
                }),
        },
        {
            scope: 'a row id repeated inside one frozen MIDI take source',
            document: () => midiTakeProjectSlots({ sourceNoteIds: ['note-1', 'note-1'] }),
        },
        {
            scope: 'a gain point id repeated inside one clip envelope',
            document: () =>
                rootDocumentWith({
                    gainEnvelopes: { envelopes: { 'clip-vocal': clipEnvelope('clip-vocal', ['point-1', 'point-1']) } },
                }),
        },
        {
            // The staged structure check keys clips and tracks apart, so only
            // the duplicate-id scan can see this collision.
            scope: 'a live clip id repeating a live track id',
            document: () => midiTakeProjectSlots({ secondClipId: 'track-keys' }),
        },
    ])('still fails $scope inside a document change', ({ document }) => {
        const state = inspectInsideDocumentChange(document());

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('still fails two live MIDI notes sharing an id beside frozen take sources', () => {
        mocks.getCrdtDoc.mockReturnValue(midiTakeProjectSlots({ liveNoteIds: ['note-1', 'note-1'] }));

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('still fails a row id repeated inside one frozen MIDI take source', () => {
        mocks.getCrdtDoc.mockReturnValue(midiTakeProjectSlots({ sourceNoteIds: ['note-1', 'note-1'] }));

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('still fails a take whose own id repeats a clip id', () => {
        mocks.getCrdtDoc.mockReturnValue(midiTakeProjectSlots({ secondTakeId: 'clip-b' }));

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('still fails a repeated id elsewhere in a snapshot carrying frozen take sources', () => {
        mocks.getCrdtDoc.mockReturnValue(
            midiTakeArrangementDocument({
                tempoMap: {
                    changes: [
                        { id: 'tempo-1', beat: 0, tempo: 120, curve: 'instant' },
                        { id: 'tempo-1', beat: 8, tempo: 90, curve: 'instant' },
                    ],
                },
            })
        );

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('admits a chord track whose migration base copies the live chord event ids', () => {
        // The chord slot keeps the state it was first written from as its merge
        // base (#606), so every live chord id appears twice by design.
        mocks.getCrdtDoc.mockReturnValue(
            rootDocumentWith({ chordTrack: chordTrackSlot(['chord-1', 'chord-2'], ['chord-1', 'chord-2']) })
        );

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(true);
    });

    it('still fails a chord id repeated inside the chord migration base', () => {
        mocks.getCrdtDoc.mockReturnValue(
            rootDocumentWith({ chordTrack: chordTrackSlot(['chord-1'], ['chord-1', 'chord-1']) })
        );

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it.each(['track-vocal', 'clip-vocal'])('still fails a live chord event id equal to the live entity %s', (id) => {
        mocks.getCrdtDoc.mockReturnValue(rootDocumentWith({ chordTrack: chordTrackSlot([id], []) }));

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('admits arrangement snapshots and gain envelopes that copy live ids under distinct owners', () => {
        const tracks = rootDocumentWith({}).tracks;
        const envelope = (clipId: string) => ({
            clipId,
            enabled: true,
            points: [{ id: 'track-vocal', beatOffset: 0, gainDb: -6 }],
        });
        mocks.getCrdtDoc.mockReturnValue(
            rootDocumentWith({
                arrangements: {
                    activeArrangementId: 'arrangement-1',
                    arrangements: [
                        { id: 'arrangement-1', tracks },
                        { id: 'arrangement-2', tracks },
                    ],
                },
                gainEnvelopes: {
                    envelopes: { 'clip-vocal': envelope('clip-vocal'), 'clip-copy': envelope('clip-copy') },
                },
            })
        );

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(true);
    });

    it('still fails two arrangement snapshots under one arrangement id', () => {
        const tracks = rootDocumentWith({}).tracks;
        mocks.getCrdtDoc.mockReturnValue(
            rootDocumentWith({
                arrangements: {
                    activeArrangementId: 'arrangement-1',
                    arrangements: [
                        { id: 'arrangement-1', tracks },
                        { id: 'arrangement-1', tracks },
                    ],
                },
            })
        );

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('still fails an id repeated inside one arrangement snapshot', () => {
        mocks.getCrdtDoc.mockReturnValue(
            rootDocumentWith({
                arrangements: {
                    activeArrangementId: 'arrangement-1',
                    arrangements: [{ id: 'arrangement-1', tracks: { tracks: [{ id: 'track-a' }, { id: 'track-a' }] } }],
                },
            })
        );

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('still fails a gain point id repeated inside one clip envelope', () => {
        mocks.getCrdtDoc.mockReturnValue(
            rootDocumentWith({
                gainEnvelopes: {
                    envelopes: {
                        'clip-vocal': {
                            clipId: 'clip-vocal',
                            enabled: true,
                            points: [
                                { id: 'point-1', beatOffset: 0, gainDb: -6 },
                                { id: 'point-1', beatOffset: 1, gainDb: -12 },
                            ],
                        },
                    },
                },
            })
        );

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    // Each multi-root scope: the first root is clean, so only a scan of a later
    // root can see the repeated id.
    it.each([
        {
            scope: 'a later arrangement snapshot',
            slots: {
                arrangements: {
                    activeArrangementId: 'arrangement-1',
                    arrangements: [
                        { id: 'arrangement-1', tracks: { tracks: [{ id: 'track-a' }] } },
                        { id: 'arrangement-2', tracks: { tracks: [{ id: 'track-b' }, { id: 'track-b' }] } },
                    ],
                },
            },
        },
        {
            scope: 'a later clip gain envelope',
            slots: {
                gainEnvelopes: {
                    envelopes: {
                        'clip-vocal': {
                            clipId: 'clip-vocal',
                            enabled: true,
                            points: [{ id: 'point-1', beatOffset: 0, gainDb: -6 }],
                        },
                        'clip-copy': {
                            clipId: 'clip-copy',
                            enabled: true,
                            points: [
                                { id: 'point-2', beatOffset: 0, gainDb: -6 },
                                { id: 'point-2', beatOffset: 1, gainDb: -12 },
                            ],
                        },
                    },
                },
            },
        },
        {
            scope: 'a later clip warp state',
            slots: {
                warpStates: {
                    states: {
                        'clip-a': { markers: [{ id: 'm-1' }] },
                        'clip-b': { markers: [{ id: 'm-2' }, { id: 'm-2' }] },
                    },
                },
            },
        },
    ])('still fails an id repeated inside $scope', ({ slots }) => {
        mocks.getCrdtDoc.mockReturnValue(rootDocumentWith(slots));

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('still fails an undeclared slot that copies the live track rows', () => {
        // Fail-closed: a subtree repeats live ids legitimately only when it is
        // declared as an independent id scope.
        mocks.getCrdtDoc.mockReturnValue(
            rootDocumentWith({ trackHistory: { previous: { tracks: [{ id: 'track-vocal' }, { id: 'bus-vocal' }] } } })
        );

        const state = captureCommandBatchPreflightState({ assetReferences: [], targetIds: [] });

        expect(state.projectInvariantsValid).toBe(false);
    });

    it('fails closed when there is no project document at all', () => {
        mocks.getCrdtDoc.mockReturnValue(undefined);
        // Bind projectId to the identity mock alone: both mocks return 'document-identity-a' by
        // default, so that value alone would not distinguish this from a captureProjectRevision()
        // regression on the same branch.
        mocks.captureProjectIdentity.mockReturnValue('document-identity-c');

        const state = captureCommandBatchPreflightState({
            assetReferences: [{ assetHash: 'sha256:vocal', audioBufferId: 'buffer-vocal' }],
            targetIds: ['track-vocal', 'master'],
        });

        expect(state).toMatchObject({
            audioGraphValid: false,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'document-identity-c',
            projectInvariantsValid: false,
            targetFingerprints: { master: 'system-output:master' },
        });
    });
});
