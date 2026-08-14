import { change, clone, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    commandProjectDivergencePort,
    commandProjectRevisionPort,
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeVersionedCommandBatch,
    executeVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
    undo,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { automergeRepository } from '../../repositories/automergeRepository';
import { agentProjectRepairStateStore } from '../../stores/agentProjectRepairStateStore';
import { agentProjectInspectionPort } from '../agentProjectInspectionPort';
import { captureProjectRevision } from '../captureProjectRevision';
import { classifyAgentProjectDivergence } from '../classifyAgentProjectDivergence';
import { findAutomergeProjectConflicts } from '../findAutomergeProjectConflicts';
import { inspectAgentProjectDivergence } from '../inspectAgentProjectDivergence';
import { projectCrdtToStores } from '../projection/projectProjection';
import { registerCrdtStorageRuntime } from '../registerCrdtStorageRuntime';

const projectionMocks = vi.hoisted(() => ({ hydrate: vi.fn() }));

vi.mock('../projection/projectSlotProjections', () => ({
    projectSlotProjections: [
        {
            hydrate: projectionMocks.hydrate,
            slot: 'targets',
            triggerSlots: ['targets'],
        },
    ],
}));

type TargetState = {
    gain: number;
    id: string;
    name: string;
};

type TestProjectDocument = {
    audioGraphValid: boolean;
    binary: Uint8Array;
    projectInvariantsValid: boolean;
    targets: Record<string, TargetState>;
};

function inspectTestProject(input: {
    projectDocument: Readonly<Record<string, unknown>>;
    targetIds: readonly string[];
}) {
    const document = input.projectDocument as Readonly<TestProjectDocument>;
    return {
        audioGraphValid: document.audioGraphValid,
        projectInvariantsValid: document.projectInvariantsValid,
        targetFingerprints: Object.fromEntries(
            input.targetIds.flatMap((targetId) => {
                const target = document.targets[targetId];
                return target ? [[targetId, JSON.stringify(target)]] : [];
            })
        ),
    };
}

function seedProject(): void {
    automergeRepository.createProject('Agent concurrency');
    automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
        draft.audioGraphValid = true;
        draft.binary = new Uint8Array([1, 2, 3]);
        draft.projectInvariantsValid = true;
        draft.targets = {
            'track-bass': { gain: 0.8, id: 'track-bass', name: 'Bass' },
            'track-drums': { gain: 0.8, id: 'track-drums', name: 'Drums' },
        };
    });
}

function registerTargetGainHandler(
    targetStorage: ReturnType<typeof createAutomergeStorage<Record<string, TargetState>>>
): void {
    registerHandlerMap({
        setTrackGain: {
            describe: (action: Extract<AppAction, { type: 'setTrackGain' }>) => ({
                inverseAction: {
                    type: 'setTrackGain',
                    payload: {
                        expectedGain: action.payload.gain,
                        gain: action.payload.expectedGain,
                        trackId: action.payload.trackId,
                    },
                },
                label: 'Set Bass gain',
            }),
            execute: (action: Extract<AppAction, { type: 'setTrackGain' }>) => {
                const targets = targetStorage.get();
                const target = targets?.[action.payload.trackId];
                if (!targets || !target) {
                    return { status: 'conflict' };
                }
                targetStorage.set({
                    ...targets,
                    [action.payload.trackId]: { ...target, gain: action.payload.gain },
                });
                return { status: 'written' };
            },
            undoable: true,
            validate: (action: Extract<AppAction, { type: 'setTrackGain' }>) =>
                targetStorage.get()?.[action.payload.trackId]?.gain === action.payload.expectedGain,
        },
    });
}

function createTargetGainCommand(baseRevision: string) {
    return createVersionedCommandEnvelope({
        action: {
            type: 'setTrackGain',
            payload: { expectedGain: 0.8, gain: 0.6, trackId: 'track-bass' },
        },
        availableDeviceVersions: {},
        expectedEffect: 'Set Bass gain to 0.6.',
        normalizedProjectRevision: baseRevision,
        objectReferences: [{ argument: 'trackId', id: 'track-bass', scope: 'stable' }],
        parameterUnits: [
            { argument: 'expectedGain', unit: 'linear-gain' },
            { argument: 'gain', unit: 'linear-gain' },
        ],
        reason: 'Rebalance Bass.',
        time: [],
    });
}

function prepareTargetCommand() {
    seedProject();
    registerCrdtStorageRuntime();
    const targetStorage = createAutomergeStorage<Record<string, TargetState>>('root', 'targets');
    targetStorage.hydrate?.();
    registerTargetGainHandler(targetStorage);
    return {
        command: createTargetGainCommand(captureProjectRevision()),
        targetStorage,
    };
}

describe('agent concurrency and compensation', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        automergeRepository.reset();
        configureAutomergeStoragePort(null);
        agentProjectInspectionPort.setProvider(inspectTestProject);
        commandProjectDivergencePort.setProvider(inspectAgentProjectDivergence);
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandBatchPreflightPort.setProvider(({ projectDocument, targetIds }) => {
            const document = projectDocument ?? automergeRepository.getDoc<Record<string, unknown>>('root');
            if (!document) {
                throw new Error('Expected project document for command preflight');
            }
            return {
                ...inspectTestProject({ projectDocument: document, targetIds }),
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: 'project-test',
            };
        });
        agentProjectRepairStateStore.set(null);
        projectionMocks.hydrate.mockClear();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
        commandProjectDivergencePort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        commandBatchPreflightPort.setProvider(null);
        agentProjectInspectionPort.setProvider(null);
        agentProjectRepairStateStore.set(null);
        automergeRepository.reset();
    });

    it('classifies every AC-016 divergence shape without treating every new head as a conflict', () => {
        const base = {
            'track-bass': 'track:{"gain":0.8,"id":"track-bass","name":"Bass"}',
            'track-drums': 'track:{"gain":0.8,"id":"track-drums","name":"Drums"}',
        };

        expect(
            classifyAgentProjectDivergence({
                audioGraphValid: true,
                baseRevision: 'revision-1',
                baseTargetFingerprints: base,
                commandsCompatible: true,
                currentRevision: 'revision-2',
                currentTargetFingerprints: base,
                projectInvariantsValid: true,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'non-overlapping', mayReapply: true });

        expect(
            classifyAgentProjectDivergence({
                audioGraphValid: true,
                baseRevision: 'revision-1',
                baseTargetFingerprints: base,
                commandsCompatible: true,
                currentRevision: 'revision-2',
                currentTargetFingerprints: {
                    ...base,
                    'track-bass': 'track:{"gain":0.8,"id":"track-bass","name":"Bass Guitar"}',
                },
                projectInvariantsValid: true,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'compatible-same-object', mayReapply: true, targetIds: ['track-bass'] });

        expect(
            classifyAgentProjectDivergence({
                audioGraphValid: true,
                baseRevision: 'revision-1',
                baseTargetFingerprints: base,
                commandsCompatible: false,
                currentRevision: 'revision-2',
                currentTargetFingerprints: {
                    ...base,
                    'track-bass': 'track:{"gain":0.6,"id":"track-bass","name":"Bass"}',
                },
                projectInvariantsValid: true,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'ambiguous-same-object', mayReapply: false, targetIds: ['track-bass'] });

        expect(
            classifyAgentProjectDivergence({
                audioGraphValid: true,
                baseRevision: 'revision-1',
                baseTargetFingerprints: base,
                commandsCompatible: false,
                currentRevision: 'revision-2',
                currentTargetFingerprints: { 'track-drums': base['track-drums'] },
                projectInvariantsValid: true,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'deleted-target', mayReapply: false, targetIds: ['track-bass'] });

        expect(
            classifyAgentProjectDivergence({
                audioGraphValid: false,
                baseRevision: 'revision-1',
                baseTargetFingerprints: base,
                commandsCompatible: false,
                currentRevision: 'revision-2',
                currentTargetFingerprints: base,
                projectInvariantsValid: false,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'invariant-breaking', mayReapply: false });
    });

    it('uses historical Automerge heads to distinguish unrelated and compatible target edits', () => {
        seedProject();
        const baseRevision = captureProjectRevision();

        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['track-drums']!.name = 'Live Drums';
        });
        expect(
            inspectAgentProjectDivergence({
                baseRevision,
                commandsCompatible: true,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'non-overlapping', mayReapply: true });

        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['track-bass']!.name = 'Bass Guitar';
        });
        expect(
            inspectAgentProjectDivergence({
                baseRevision,
                commandsCompatible: true,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'compatible-same-object', mayReapply: true });

        expect(
            inspectAgentProjectDivergence({
                baseRevision,
                commandsCompatible: false,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'ambiguous-same-object', mayReapply: false });

        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            delete draft.targets['track-bass'];
        });
        expect(
            inspectAgentProjectDivergence({
                baseRevision,
                commandsCompatible: false,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'deleted-target', mayReapply: false });
    });

    it('revalidates and reapplies compatible stale commands while preserving collaborator fields', async () => {
        const { command, targetStorage } = prepareTargetCommand();

        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['track-bass']!.name = 'Bass Guitar';
        });
        targetStorage.hydrate?.();
        expect(targetStorage.get()?.['track-bass']).toEqual({
            gain: 0.8,
            id: 'track-bass',
            name: 'Bass Guitar',
        });

        const compiled = compileVersionedCommandBatchEnvelope({
            baseRevision: command.normalizedProjectRevision,
            batchId: 'batch-compatible-reapply',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Rebalance Bass.',
            projectId: 'project-test',
            runId: 'run-compatible-reapply',
        });
        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toMatchObject({
            divergence: { kind: 'compatible-same-object', mayReapply: true },
            status: 'committed',
        });
        expect(targetStorage.get()?.['track-bass']).toEqual({
            gain: 0.6,
            id: 'track-bass',
            name: 'Bass Guitar',
        });

        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['track-bass']!.name = 'Bass DI';
        });
        targetStorage.hydrate?.();
        await undo();
        expect(targetStorage.get()?.['track-bass']).toEqual({
            gain: 0.8,
            id: 'track-bass',
            name: 'Bass DI',
        });
    });

    it('rejects ambiguous stale commands before any project write', async () => {
        const { command, targetStorage } = prepareTargetCommand();

        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['track-bass']!.gain = 0.7;
        });
        targetStorage.hydrate?.();

        const result = await executeVersionedCommandBatch({
            commands: [serializeVersionedCommandEnvelope(command)],
        });

        expect(result).toMatchObject({
            divergence: { kind: 'ambiguous-same-object', mayReapply: false },
            status: 'conflicted',
        });
        expect(targetStorage.get()?.['track-bass']).toMatchObject({ gain: 0.7 });
    });

    it('rejects a command whose target was deleted without recreating it', async () => {
        const { command, targetStorage } = prepareTargetCommand();
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            delete draft.targets['track-bass'];
        });
        targetStorage.hydrate?.();

        const result = await executeVersionedCommandBatch({
            commands: [serializeVersionedCommandEnvelope(command)],
        });

        expect(result).toMatchObject({
            divergence: { kind: 'deleted-target', mayReapply: false },
            status: 'conflicted',
        });
        expect(targetStorage.get()?.['track-bass']).toBeUndefined();
    });

    it('rejects all commands while raw project invariants require repair', async () => {
        const { command, targetStorage } = prepareTargetCommand();
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.audioGraphValid = false;
        });

        const result = await executeVersionedCommandBatch({
            commands: [serializeVersionedCommandEnvelope(command)],
        });

        expect(result).toMatchObject({
            divergence: { kind: 'invariant-breaking', mayReapply: false },
            status: 'conflicted',
        });
        expect(targetStorage.get()?.['track-bass']).toMatchObject({ gain: 0.8 });
    });

    it('quarantines invalid raw merged truth from projections and exposes repair state', () => {
        seedProject();
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.audioGraphValid = false;
            draft.projectInvariantsValid = false;
        });

        projectCrdtToStores();

        expect(automergeRepository.getDoc<TestProjectDocument>('root')).toMatchObject({
            audioGraphValid: false,
            projectInvariantsValid: false,
        });
        expect(projectionMocks.hydrate).not.toHaveBeenCalled();
        expect(agentProjectRepairStateStore.value).toMatchObject({
            audioGraphValid: false,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            status: 'repair-required',
        });

        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.audioGraphValid = true;
            draft.projectInvariantsValid = true;
        });
        projectCrdtToStores();
        expect(agentProjectRepairStateStore.value).toBeNull();
        expect(projectionMocks.hydrate).toHaveBeenCalledOnce();
    });

    it('fails closed when merged project inspection is unavailable', () => {
        seedProject();
        agentProjectInspectionPort.setProvider(() => {
            throw new Error('Project validator unavailable');
        });

        projectCrdtToStores();

        expect(projectionMocks.hydrate).not.toHaveBeenCalled();
        expect(agentProjectRepairStateStore.value).toMatchObject({
            audioGraphValid: false,
            inspectionAvailable: false,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            status: 'repair-required',
        });
    });

    it('retains unresolved Automerge alternatives and exposes deterministic repair candidates', () => {
        seedProject();
        const baseRevision = captureProjectRevision();
        const baseDocument = automergeRepository.getDoc<TestProjectDocument>('root');
        if (!baseDocument) {
            throw new Error('Expected seeded root document');
        }
        const remoteDocument = change(clone(baseDocument, { actor: 'b'.repeat(64) }), (draft) => {
            draft.targets['track-bass']!.gain = 0.7;
        });
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['track-bass']!.gain = 0.6;
        });
        automergeRepository.mergeRemoteDoc('root', save(remoteDocument));

        const mergedDocument = automergeRepository.getDoc<TestProjectDocument>('root');
        if (!mergedDocument) {
            throw new Error('Expected merged root document');
        }
        expect(
            findAutomergeProjectConflicts({
                document: mergedDocument,
                targetIds: ['track-bass'],
            })
        ).toEqual([
            {
                conflictIds: [expect.any(String), expect.any(String)],
                path: ['targets', 'track-bass', 'gain'],
                targetIds: ['track-bass'],
            },
        ]);
        expect(
            inspectAgentProjectDivergence({
                baseRevision,
                commandsCompatible: true,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'ambiguous-same-object', mayReapply: false });

        projectCrdtToStores();

        expect(projectionMocks.hydrate).not.toHaveBeenCalled();
        expect(agentProjectRepairStateStore.value).toMatchObject({
            rawProjectRetained: true,
            repairCandidates: [
                {
                    kind: 'choose-automerge-conflict-value',
                    path: ['targets', 'track-bass', 'gain'],
                    targetIds: ['track-bass'],
                },
            ],
            status: 'repair-required',
        });
    });
});
