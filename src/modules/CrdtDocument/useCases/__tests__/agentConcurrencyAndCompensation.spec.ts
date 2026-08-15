import { change, clone, save } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import * as automergeStorage from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    commandBatchPreviewPort,
    commandProjectDivergencePort,
    commandProjectRevisionPort,
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeAppAction,
    executeVersionedCommandBatch,
    executeVersionedCommandBatchEnvelope,
    issueCommandApprovalBinding,
    serializeVersionedCommandEnvelope,
    undo,
} from '#/modules/Command/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { type AppAction } from '#/utils/handlerContract';

import { automergeRepository } from '../../repositories/automergeRepository';
import { agentProjectRepairStateStore } from '../../stores/agentProjectRepairStateStore';
import { agentProjectInspectionPort } from '../agentProjectInspectionPort';
import { captureProjectRevision } from '../captureProjectRevision';
import { classifyAgentProjectDivergence } from '../classifyAgentProjectDivergence';
import { createCommandPreviewWorkspace } from '../createCommandPreviewWorkspace';
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
    color?: string;
    gain: number;
    id: string;
    name: string;
};

type TestProjectDocument = {
    audioGraphValid: boolean;
    binary: Uint8Array;
    projectInvariantsValid: boolean;
    midi?: unknown;
    targets: Record<string, TargetState>;
    transport: {
        isLooping: boolean;
        loopEnd: number;
        loopStart: number;
        masterGain: number;
        tempo: number;
    };
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
                if (targetId === '@project/transport/tempo') {
                    return [[targetId, JSON.stringify(document.transport.tempo)]];
                }
                if (targetId === '@project/transport/master-gain') {
                    return [[targetId, JSON.stringify(document.transport.masterGain)]];
                }
                if (targetId === '@project/transport/loop') {
                    return [
                        [
                            targetId,
                            JSON.stringify({
                                enabled: document.transport.isLooping,
                                endBeat: document.transport.loopEnd,
                                startBeat: document.transport.loopStart,
                            }),
                        ],
                    ];
                }
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
            'marker-verse': { color: '#0088ff', gain: 0, id: 'marker-verse', name: 'Verse' },
        };
        draft.transport = { isLooping: false, loopEnd: 16, loopStart: 0, masterGain: 80, tempo: 120 };
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
            previewExecution: 'isolated-project',
            requiresAbortCompensation: false,
            undoable: true,
            canReapplyAfterDivergence: () => true,
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
        commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
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
        commandBatchPreviewPort.setProvider(null);
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

    it('never reapplies a command across project identity replacement', () => {
        seedProject();
        const baseRevision = captureProjectRevision();
        automergeRepository.createProject('Replacement project');
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.audioGraphValid = true;
            draft.binary = new Uint8Array([1, 2, 3]);
            draft.projectInvariantsValid = true;
            draft.targets = {
                'track-bass': { gain: 0.8, id: 'track-bass', name: 'Bass' },
            };
        });

        expect(
            inspectAgentProjectDivergence({
                baseRevision,
                commandsCompatible: true,
                targetIds: ['track-bass'],
            })
        ).toMatchObject({ kind: 'ambiguous-same-object', mayReapply: false });
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
            approvalBinding: issueCommandApprovalBinding({
                ...compiled,
                validate: () => ({ status: 'valid' }),
            }),
            authority: compiled.authority,
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

    it('previews a compatible stale command against current truth without touching the live project', async () => {
        const { command, targetStorage } = prepareTargetCommand();
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['track-bass']!.name = 'Bass Guitar';
        });
        targetStorage.hydrate?.();
        const compiled = compileVersionedCommandBatchEnvelope({
            baseRevision: command.normalizedProjectRevision,
            batchId: 'batch-compatible-preview',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview Bass rebalance.',
            mode: 'preview',
            projectId: 'project-test',
            runId: 'run-compatible-preview',
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            serialized: compiled.serialized,
        });

        expect(result).toMatchObject({
            divergence: { kind: 'compatible-same-object', mayReapply: true },
            projectDocument: {
                targets: {
                    'track-bass': { gain: 0.6, id: 'track-bass', name: 'Bass Guitar' },
                },
            },
            status: 'previewed',
        });
        expect(targetStorage.get()?.['track-bass']).toMatchObject({ gain: 0.8, name: 'Bass Guitar' });
        if (result.status === 'previewed') {
            result.resource.release();
        }
    });

    it('reclassifies a certified stale preview when current-head validation conflicts', async () => {
        const { command, targetStorage } = prepareTargetCommand();
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['track-bass']!.gain = 0.7;
        });
        targetStorage.hydrate?.();
        const compiled = compileVersionedCommandBatchEnvelope({
            baseRevision: command.normalizedProjectRevision,
            batchId: 'batch-conflicted-preview',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview stale Bass rebalance.',
            mode: 'preview',
            projectId: 'project-test',
            runId: 'run-conflicted-preview',
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            serialized: compiled.serialized,
        });

        expect(result).toMatchObject({
            divergence: {
                kind: 'ambiguous-same-object',
                mayReapply: false,
                repairCandidates: [{ kind: 'review-ambiguous-target', targetIds: ['track-bass'] }],
                targetIds: ['track-bass'],
            },
            status: 'conflicted',
        });
        expect(targetStorage.get()?.['track-bass']).toMatchObject({ gain: 0.7 });
    });

    it('refuses same-object stale reapply without an explicit per-action compatibility proof', async () => {
        const { command, targetStorage } = prepareTargetCommand();
        clearHandlerRegistry();
        registerHandlerMap({
            setTrackGain: {
                describe: () => ({ inverseAction: null, label: 'Unsafe gain write' }),
                execute: vi.fn(() => {
                    throw new Error('must not execute');
                }),
                undoable: false,
                validate: () => true,
            },
        });
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['track-bass']!.name = 'Bass Guitar';
        });
        targetStorage.hydrate?.();

        const result = await executeVersionedCommandBatch({
            commands: [serializeVersionedCommandEnvelope(command)],
        });

        expect(result).toMatchObject({
            divergence: { kind: 'ambiguous-same-object', mayReapply: false },
            status: 'conflicted',
        });
        expect(targetStorage.get()?.['track-bass']).toMatchObject({ gain: 0.8, name: 'Bass Guitar' });
    });

    it('treats global tempo as a project-slot target instead of non-overlapping state', async () => {
        seedProject();
        registerCrdtStorageRuntime();
        const execute = vi.fn();
        registerHandlerMap({
            setTempo: {
                describe: () => ({ inverseAction: null, label: 'Set tempo' }),
                execute,
                undoable: false,
                validate: () => true,
            },
        });
        const baseRevision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: { type: 'setTempo', payload: { bpm: 100 } },
            availableDeviceVersions: {},
            expectedEffect: 'Set tempo.',
            normalizedProjectRevision: baseRevision,
            objectReferences: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            reason: 'Change tempo.',
            time: [],
        });
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.transport.tempo = 90;
        });

        const result = await executeVersionedCommandBatch({
            commands: [serializeVersionedCommandEnvelope(command)],
        });

        expect(result).toMatchObject({
            divergence: { kind: 'ambiguous-same-object', mayReapply: false },
            status: 'conflicted',
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('treats master gain as a project-slot target instead of non-overlapping state', async () => {
        seedProject();
        registerCrdtStorageRuntime();
        const execute = vi.fn();
        registerHandlerMap({
            setMasterGain: {
                describe: () => ({ inverseAction: null, label: 'Set master gain' }),
                execute,
                undoable: false,
                validate: () => true,
            },
        });
        const baseRevision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: { type: 'setMasterGain', payload: { gain: 0.7 } },
            availableDeviceVersions: {},
            expectedEffect: 'Set master gain.',
            normalizedProjectRevision: baseRevision,
            objectReferences: [],
            parameterUnits: [{ argument: 'gain', unit: 'linear-gain' }],
            reason: 'Change master gain.',
            time: [],
        });
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.transport.masterGain = 75;
        });

        const result = await executeVersionedCommandBatch({
            commands: [serializeVersionedCommandEnvelope(command)],
        });

        expect(result).toMatchObject({
            divergence: { kind: 'ambiguous-same-object', mayReapply: false },
            status: 'conflicted',
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('does not reapply a stale marker mutation whose target rules are provider-empty', async () => {
        seedProject();
        registerCrdtStorageRuntime();
        const execute = vi.fn();
        registerHandlerMap({
            setMarkerColor: {
                describe: () => ({ inverseAction: null, label: 'Set marker color' }),
                execute,
                undoable: false,
                validate: () => true,
            },
        });
        const baseRevision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: { type: 'setMarkerColor', payload: { markerId: 'marker-verse', color: '#ff8800' } },
            availableDeviceVersions: {},
            expectedEffect: 'Set Verse marker color.',
            normalizedProjectRevision: baseRevision,
            objectReferences: [{ argument: 'markerId', id: 'marker-verse', scope: 'stable' }],
            parameterUnits: [],
            reason: 'Recolor Verse marker.',
            time: [],
        });
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['marker-verse']!.color = '#44cc88';
        });

        const result = await executeVersionedCommandBatch({
            commands: [serializeVersionedCommandEnvelope(command)],
            divergenceTargetIds: [],
        });

        expect(result).toMatchObject({
            divergence: { kind: 'ambiguous-same-object', mayReapply: false, targetIds: ['marker-verse'] },
            status: 'conflicted',
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('distinguishes unrelated edits from stale writes to a targetless durable transport slot', async () => {
        seedProject();
        registerCrdtStorageRuntime();
        const execute = vi.fn();
        registerHandlerMap({
            setLoopEnabled: {
                describe: () => ({ inverseAction: null, label: 'Enable loop' }),
                execute,
                undoable: false,
                validate: () => true,
            },
        });
        const createCommand = () =>
            createVersionedCommandEnvelope({
                action: { type: 'setLoopEnabled', payload: { enabled: true } },
                availableDeviceVersions: {},
                expectedEffect: 'Enable the loop region.',
                normalizedProjectRevision: captureProjectRevision(),
                objectReferences: [],
                parameterUnits: [],
                reason: 'Enable looping.',
                time: [],
            });
        const unrelatedCommand = createCommand();
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.targets['track-drums']!.name = 'Live Drums';
        });

        await expect(
            executeVersionedCommandBatch({
                commands: [serializeVersionedCommandEnvelope(unrelatedCommand)],
                divergenceTargetIds: [],
            })
        ).resolves.toMatchObject({
            divergence: { kind: 'non-overlapping', mayReapply: true },
            status: 'committed',
        });
        expect(execute).toHaveBeenCalledOnce();

        execute.mockClear();
        const staleLoopCommand = createCommand();
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.transport.isLooping = true;
        });
        await expect(
            executeVersionedCommandBatch({
                commands: [serializeVersionedCommandEnvelope(staleLoopCommand)],
                divergenceTargetIds: [],
            })
        ).resolves.toMatchObject({
            divergence: {
                kind: 'ambiguous-same-object',
                mayReapply: false,
                targetIds: ['@project/transport/loop'],
            },
            status: 'conflicted',
        });
        expect(execute).not.toHaveBeenCalled();
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

    it('quarantines malformed raw MIDI rows instead of silently sanitizing them from the projection', () => {
        void midiStore.value;
        seedProject();
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.midi = {
                probabilitySeed: 1,
                notesByClipId: {
                    'clip-midi': [
                        {
                            id: 'note-invalid',
                            pitch: 60,
                            startBeat: 0,
                            duration: 1,
                            velocity: 100,
                            collaboratorFieldThisBuildCannotProject: true,
                        },
                    ],
                },
                ccByClipId: {},
                pitchBendByClipId: {},
            };
        });

        projectCrdtToStores();

        expect(automergeRepository.getDoc<TestProjectDocument>('root')?.midi).toMatchObject({
            notesByClipId: {
                'clip-midi': [expect.objectContaining({ collaboratorFieldThisBuildCannotProject: true })],
            },
        });
        expect(projectionMocks.hydrate).not.toHaveBeenCalled();
        expect(agentProjectRepairStateStore.value).toMatchObject({
            rawProjectRetained: true,
            repairCandidates: [
                {
                    kind: 'repair-project-invariants',
                    targetIds: ['@project/raw/midi'],
                },
            ],
            status: 'repair-required',
        });
    });

    it('allows additive legacy MIDI defaults when projection preserves every raw field and row', () => {
        void midiStore.value;
        seedProject();
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.midi = {
                notesByClipId: {
                    'clip-midi': [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
                },
                ccByClipId: {},
                pitchBendByClipId: {},
            };
        });

        projectCrdtToStores();

        expect(agentProjectRepairStateStore.value).toBeNull();
        expect(projectionMocks.hydrate).toHaveBeenCalledOnce();
    });

    it('resets stale projection caches before quarantining an invalid project load', () => {
        seedProject();
        automergeRepository.changeDoc<TestProjectDocument>('root', (draft) => {
            draft.audioGraphValid = false;
            draft.projectInvariantsValid = false;
        });
        const reset = vi.spyOn(automergeStorage, 'resetAutomergeStorageProjections');

        projectCrdtToStores({ resetProjections: true });

        expect(reset).toHaveBeenCalledWith('root');
        expect(projectionMocks.hydrate).not.toHaveBeenCalled();
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

    it('should retain unresolved Automerge alternatives and block ordinary writes until typed repair', async () => {
        const { targetStorage } = prepareTargetCommand();
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

        await expect(
            executeAppAction({
                type: 'setTrackGain',
                payload: { expectedGain: 0.8, gain: 0.5, trackId: 'track-bass' },
            })
        ).rejects.toThrow('Action conflicts with current project state: setTrackGain');

        const retainedDocument = automergeRepository.getDoc<TestProjectDocument>('root');
        expect(retainedDocument).not.toBeNull();
        expect(
            findAutomergeProjectConflicts({
                document: retainedDocument!,
                targetIds: ['track-bass'],
            })
        ).toEqual([
            {
                conflictIds: [expect.any(String), expect.any(String)],
                path: ['targets', 'track-bass', 'gain'],
                targetIds: ['track-bass'],
            },
        ]);
        expect(targetStorage.get()?.['track-bass']).toMatchObject({ gain: 0.8 });
    });
});
