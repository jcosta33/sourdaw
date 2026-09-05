import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandTrackDefaultsPort,
    compilePartialCommandBatchAcceptance,
    executeVersionedCommandBatchEnvelope,
    issueCommandApprovalBinding,
    parseVersionedCommandBatchEnvelope,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { bridgeGroundedLlmToolCalls } from '../agentReference/bridgeGroundedLlmToolCalls';
import { materializeBatchLocalActionIdentities } from '../agentReference/materializeBatchLocalActionIdentities';
import { compileArbitraryCommandList } from '../compileArbitraryCommandList';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { getProjectContext } from '../getProjectContext';
import { materializeActionStateGuards } from '../materializeActionStateGuards';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const runtimeMocks = vi.hoisted(() => ({
    matchesRuntimeDeviceChainTopology: vi.fn(() => true),
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    matchesRuntimeDeviceChainTopology: runtimeMocks.matchesRuntimeDeviceChainTopology,
    updateDeviceParam: runtimeMocks.updateDeviceParam,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const prompt =
    'Create a MIDI track named Lead with a four-beat Melody clip, add C4 at beat 0 and G4 at beat 1, then add Filter A, set its Type to Highpass, and add Filter B after Filter A.';

const plan = {
    semantic: { classification: 'simple', uncertainty: [] },
    objective: 'Create and configure the requested MIDI phrase.',
    constraints: [],
    scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
    capabilityIds: [],
    assetIds: [],
    alternatives: [],
    validationStrategy: [],
    stoppingConditions: [],
};

const providerItems = [
    { id: 'make-lead', name: 'addTrack', arguments: { name: 'Lead', kind: 'midi', binding: 'lead' } },
    {
        id: 'make-melody',
        name: 'addClip',
        arguments: { trackId: '$lead', startBeat: 0, endBeat: 4, name: 'Melody', binding: 'melody' },
        dependsOn: ['make-lead'],
    },
    {
        id: 'add-phrase',
        name: 'addNotes',
        arguments: {
            clipId: '$melody',
            notes: [
                { pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                { pitch: 67, startBeat: 1, duration: 1, velocity: 92 },
            ],
        },
        dependsOn: ['make-melody'],
    },
    {
        id: 'add-filter',
        name: 'addDevice',
        arguments: { trackId: '$lead', deviceType: 'builtin-filter', binding: 'filter' },
        dependsOn: ['make-lead'],
    },
    {
        id: 'set-filter-type',
        name: 'setDeviceParameter',
        arguments: { deviceId: '$filter', paramId: 'filter-type', value: 1 },
        dependsOn: ['add-filter'],
    },
    {
        id: 'add-second-filter',
        name: 'addDevice',
        arguments: {
            trackId: '$lead',
            deviceType: 'builtin-filter',
            binding: 'second-filter',
            afterDeviceId: '$filter',
        },
        dependsOn: ['set-filter-type'],
    },
] as const;

const siblingDevicePrompt =
    'Create a MIDI track named Lead with Filter A and independently add Filter B. Also create an audio track named Reference and add a Filter to it.';

const siblingDeviceProviderItems = [
    { id: 'make-lead', name: 'addTrack', arguments: { name: 'Lead', kind: 'midi', binding: 'lead' } },
    {
        id: 'add-filter-a',
        name: 'addDevice',
        arguments: { trackId: '$lead', deviceType: 'builtin-filter', binding: 'filter-a' },
        dependsOn: ['make-lead'],
    },
    {
        id: 'add-filter-b',
        name: 'addDevice',
        arguments: { trackId: '$lead', deviceType: 'builtin-filter', binding: 'filter-b' },
        dependsOn: ['make-lead'],
    },
    { id: 'make-reference', name: 'addTrack', arguments: { name: 'Reference', kind: 'audio', binding: 'reference' } },
    {
        id: 'add-reference-filter',
        name: 'addDevice',
        arguments: { trackId: '$reference', deviceType: 'builtin-filter', binding: 'reference-filter' },
        dependsOn: ['make-reference'],
    },
] as const;

type WorkflowProviderItems = typeof providerItems | typeof siblingDeviceProviderItems;

function materializeWorkflow(
    projectRevision: string,
    workflowPrompt: string = prompt,
    workflowProviderItems: WorkflowProviderItems = providerItems
) {
    const context = getProjectContext();
    const compiled = compileArbitraryCommandList({
        context,
        revision: projectRevision,
        calls: [
            {
                name: 'command.batch.propose',
                arguments: { plan, list: { schemaVersion: 1, items: workflowProviderItems } },
            },
        ],
    });
    if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
        throw new Error(compiled.status === 'rejected' ? compiled.reason : 'Expected compiler evidence');
    }
    const bridged = bridgeGroundedLlmToolCalls({
        calls: compiled.compilerEvidence.commands,
        compilerEvidence: compiled.compilerEvidence,
        context,
        projectRevision,
        prompt: workflowPrompt,
    });
    if (bridged.rejections.length > 0) {
        throw new Error(bridged.rejections.map((rejection) => rejection.reason).join('; '));
    }
    const identified = materializeBatchLocalActionIdentities(bridged.actions, bridged.batchLocalActionIdentities ?? []);
    if (identified.status !== 'accepted') {
        throw new Error(identified.reason);
    }
    const guarded = materializeActionStateGuards(identified.actions, context);
    if (guarded.status !== 'accepted') {
        throw new Error(guarded.reason);
    }
    if (bridged.actionCommandGraph === undefined) {
        throw new Error('Expected an action command graph');
    }
    return { actions: guarded.actions, actionCommandGraph: bridged.actionCommandGraph, context };
}

function compileWorkflowCommandBatch(
    input: ReturnType<typeof materializeWorkflow>,
    projectRevision: string,
    id: string
) {
    return compilePlannedActionCommandBatch({
        actions: input.actions,
        actionCommandGraph: input.actionCommandGraph,
        actionLabels: input.actions.map((action) => action.type),
        autoCommit: true,
        autoCommitApproval: () => ({ status: 'valid' as const }),
        context: input.context,
        group: { groupId: `group-${id}`, groupLabel: 'Create filtered MIDI phrase' },
        intent: prompt,
        mode: 'commit',
        projectRevision,
        runId: `run-${id}`,
    }).commandBatch;
}

describe('typed created-device binding Command workflow', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Typed created-device binding workflow test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        configureAiWorkflowCommandPreflightFixture();
        clearHandlerRegistry();
        registerHandlerMap({ ...getArrangementHandlers(), ...getMidiNoteTransformHandlers() });
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        commandTrackDefaultsPort.setTrackColorProvider(() => '#456789');
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        resetAiWorkflowCommandPreflightFixture();
        commandTrackDefaultsPort.setTrackColorProvider(null);
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('retains guarded sibling device producers when partially accepting the later device', async () => {
        const revision = captureProjectRevision();
        const workflow = materializeWorkflow(revision, siblingDevicePrompt, siblingDeviceProviderItems);
        const [trackAction, firstDeviceAction, secondDeviceAction] = workflow.actions;
        if (
            trackAction?.type !== 'addTrack' ||
            firstDeviceAction?.type !== 'addDevice' ||
            secondDeviceAction?.type !== 'addDevice'
        ) {
            throw new Error('Expected the Lead, Filter A, Filter B action sequence');
        }
        expect(firstDeviceAction.payload.expectedDeviceIds).toEqual([trackAction.payload.initialDeviceId]);
        expect(secondDeviceAction.payload.expectedDeviceIds).toEqual([
            trackAction.payload.initialDeviceId,
            firstDeviceAction.payload.deviceId,
        ]);

        const previewBatch = compilePlannedActionCommandBatch({
            actions: workflow.actions,
            actionCommandGraph: workflow.actionCommandGraph,
            actionLabels: workflow.actions.map((action) => action.type),
            autoCommit: false,
            context: workflow.context,
            group: { groupId: 'group-sibling-preview', groupLabel: 'Preview independent device branches' },
            intent: siblingDevicePrompt,
            mode: 'preview',
            projectRevision: revision,
            runId: 'run-sibling-preview',
        }).commandBatch;
        const parsedPreview = parseVersionedCommandBatchEnvelope(previewBatch.serialized, previewBatch.authority);
        if (parsedPreview.status !== 'valid') {
            throw new Error(parsedPreview.reason);
        }
        const [trackCommand, firstDeviceCommand, secondDeviceCommand] = parsedPreview.envelope.commands;
        if (!trackCommand || !firstDeviceCommand || !secondDeviceCommand) {
            throw new Error('Expected the Lead, Filter A, Filter B commands');
        }
        expect(parsedPreview.envelope.commands.map((command) => command.operation)).toEqual([
            'addTrack',
            'addDevice',
            'addDevice',
            'addTrack',
            'addDevice',
        ]);

        const preview = await executeVersionedCommandBatchEnvelope(previewBatch);
        if (preview.status !== 'previewed') {
            throw new Error(`Expected preview, received ${preview.status}`);
        }
        const partial = compilePartialCommandBatchAcceptance({
            batchId: 'group-sibling-partial',
            previewSelection: preview.partialAcceptance,
            runId: 'run-sibling-partial',
            selectedIntentGroupIds: [secondDeviceCommand.commandId],
        });
        if (partial.status !== 'compiled') {
            throw new Error(partial.reason);
        }
        const parsedPartial = parseVersionedCommandBatchEnvelope(partial.serialized, partial.authority);
        if (parsedPartial.status !== 'valid') {
            throw new Error(parsedPartial.reason);
        }
        preview.resource.release();

        const partialApproval = issueCommandApprovalBinding({
            authority: partial.authority,
            serialized: partial.serialized,
            validate: () => ({ status: 'valid' }),
        });
        const outcome = await executeVersionedCommandBatchEnvelope({
            authority: partial.authority,
            approvalBinding: partialApproval,
            serialized: partial.serialized,
        });
        expect(outcome, JSON.stringify(outcome)).toMatchObject({ status: 'committed' });

        expect(partial.includedOriginalCommandIds).toEqual([
            trackCommand.commandId,
            firstDeviceCommand.commandId,
            secondDeviceCommand.commandId,
        ]);
        const [partialTrack, partialFirstDevice, partialSecondDevice] = parsedPartial.envelope.commands;
        if (!partialTrack || !partialFirstDevice || !partialSecondDevice) {
            throw new Error('Expected the retained Lead, Filter A, Filter B commands');
        }
        expect(parsedPartial.envelope.commands.map((command) => command.operation)).toEqual([
            'addTrack',
            'addDevice',
            'addDevice',
        ]);
        expect(partialFirstDevice.dependencyIds).toEqual([partialTrack.commandId]);
        expect(partialSecondDevice.dependencyIds).toEqual([partialTrack.commandId, partialFirstDevice.commandId]);
        expect(parsedPartial.envelope.batchLocalBindings).toEqual([]);
        expect(partialTrack.arguments).toEqual(trackCommand.arguments);
        expect(partialFirstDevice.arguments).toEqual(firstDeviceCommand.arguments);
        expect(partialSecondDevice.arguments).toEqual(secondDeviceCommand.arguments);
        const createdTrack = trackStore.value?.tracks[0];
        expect(trackStore.value?.tracks).toHaveLength(1);
        expect(createdTrack?.name).toBe('Lead');
        expect(createdTrack?.clips).toEqual([]);
        expect(createdTrack?.devices.map((device) => device.id)).toEqual([
            partialTrack.arguments.initialDeviceId,
            partialFirstDevice.arguments.deviceId,
            partialSecondDevice.arguments.deviceId,
        ]);
        const committedTrack = structuredClone(createdTrack);

        expect(await undo()).toEqual({ headConsumed: true });
        expect(trackStore.value?.tracks).toEqual([]);
        await redo();
        expect(trackStore.value?.tracks).toEqual([committedTrack]);
    });

    it('carries sparse descriptor legal values through context into created-device compilation', () => {
        const context = getProjectContext();
        const oversampling = context.availableDeviceTypes
            ?.find((device) => device.id === 'gluten')
            ?.parameters?.find((parameter) => parameter.id === 'oversampling');
        expect(oversampling?.legalValues).toEqual([1, 2, 4]);

        const compileValue = (value: number) => {
            const valuePrompt = `Create a MIDI track named Lead, add Gluten, and set its Oversampling to ${String(value)}.`;
            const compiled = compileArbitraryCommandList({
                context,
                revision: `revision-gluten-${String(value)}`,
                calls: [
                    {
                        name: 'command.batch.propose',
                        arguments: {
                            plan,
                            list: {
                                schemaVersion: 1,
                                items: [
                                    {
                                        id: 'make-lead',
                                        name: 'addTrack',
                                        arguments: { name: 'Lead', kind: 'midi', binding: 'lead' },
                                    },
                                    {
                                        id: 'add-gluten',
                                        name: 'addDevice',
                                        arguments: { trackId: '$lead', deviceType: 'gluten', binding: 'gluten' },
                                        dependsOn: ['make-lead'],
                                    },
                                    {
                                        id: 'set-oversampling',
                                        name: 'setDeviceParameter',
                                        arguments: { deviceId: '$gluten', paramId: 'oversampling', value },
                                        dependsOn: ['add-gluten'],
                                    },
                                ],
                            },
                        },
                    },
                ],
            });
            if (compiled.status !== 'accepted' || compiled.compilerEvidence === undefined) {
                throw new Error(compiled.status === 'rejected' ? compiled.reason : 'Expected compiler evidence');
            }
            return bridgeGroundedLlmToolCalls({
                calls: compiled.compilerEvidence.commands,
                compilerEvidence: compiled.compilerEvidence,
                context,
                projectRevision: `revision-gluten-${String(value)}`,
                prompt: valuePrompt,
            });
        };

        const invalid = compileValue(3);
        expect(invalid.actions).toEqual([]);
        expect(invalid.rejections).not.toEqual([]);
        expect(JSON.stringify(invalid)).not.toMatch(/(?:track|device)-ai-/u);

        for (const value of [1, 2, 4]) {
            const valid = compileValue(value);
            expect(valid.rejections).toEqual([]);
            expect(valid.actions).toHaveLength(3);
            expect(valid.actions[2]).toMatchObject({
                type: 'setDeviceParameter',
                payload: { paramId: 'oversampling', value },
            });
        }
    });

    it('commits one typed batch and round-trips its exact identities, notes, device order, and value', async () => {
        const revision = captureProjectRevision();
        const workflow = materializeWorkflow(revision);
        const deviceOnlyActions = [
            workflow.actions[0]!,
            workflow.actions[3]!,
            workflow.actions[4]!,
            workflow.actions[5]!,
        ];
        const [trackAction, firstDeviceAction, parameterAction, secondDeviceAction] = deviceOnlyActions;
        if (
            trackAction?.type !== 'addTrack' ||
            firstDeviceAction?.type !== 'addDevice' ||
            parameterAction?.type !== 'setDeviceParameter' ||
            secondDeviceAction?.type !== 'addDevice'
        ) {
            throw new Error('Expected the ordered track, Filter A, parameter, Filter B action sequence');
        }
        expect(parameterAction.payload.expectedDeviceIds).toEqual([
            trackAction.payload.initialDeviceId,
            firstDeviceAction.payload.deviceId,
        ]);
        expect(secondDeviceAction.payload.expectedDeviceIds).toEqual([
            trackAction.payload.initialDeviceId,
            firstDeviceAction.payload.deviceId,
        ]);
        const previewBatch = compilePlannedActionCommandBatch({
            actions: deviceOnlyActions,
            actionCommandGraph: {
                dependenciesByActionIndex: [[], [0], [1], [2]],
                batchLocalBindings: [
                    { bindingId: '$lead', producerActionIndex: 0, producerArgument: 'id' },
                    { bindingId: '$filter', producerActionIndex: 1, producerArgument: 'deviceId' },
                    { bindingId: '$second-filter', producerActionIndex: 3, producerArgument: 'deviceId' },
                ],
            },
            actionLabels: deviceOnlyActions.map((action) => action.type),
            autoCommit: false,
            context: workflow.context,
            group: { groupId: 'group-partial-preview', groupLabel: 'Preview filtered MIDI track' },
            intent: prompt,
            mode: 'preview',
            projectRevision: revision,
            runId: 'run-partial-preview',
        }).commandBatch;
        const parsedPreview = parseVersionedCommandBatchEnvelope(previewBatch.serialized, previewBatch.authority);
        if (parsedPreview.status !== 'valid') {
            throw new Error(parsedPreview.reason);
        }
        const parameterCommand = parsedPreview.envelope.commands[2];
        if (parameterCommand === undefined) {
            throw new Error('Expected the created-device parameter command');
        }
        const preview = await executeVersionedCommandBatchEnvelope(previewBatch);
        if (preview.status !== 'previewed') {
            throw new Error(`Expected preview, received ${preview.status}`);
        }
        const partial = compilePartialCommandBatchAcceptance({
            batchId: 'group-partial-commit',
            previewSelection: preview.partialAcceptance,
            runId: 'run-partial-commit',
            selectedIntentGroupIds: [parameterCommand.commandId],
        });
        expect(partial).toMatchObject({
            status: 'compiled',
            includedOriginalCommandIds: parsedPreview.envelope.commands.slice(0, 3).map((command) => command.commandId),
        });
        if (partial.status !== 'compiled') {
            throw new Error(partial.reason);
        }
        const parsedPartial = parseVersionedCommandBatchEnvelope(partial.serialized, partial.authority);
        if (parsedPartial.status !== 'valid') {
            throw new Error(parsedPartial.reason);
        }
        const [partialTrack, partialDevice, partialParameter] = parsedPartial.envelope.commands;
        expect(parsedPartial.envelope.commands.map((command) => command.operation)).toEqual([
            'addTrack',
            'addDevice',
            'setDeviceParameter',
        ]);
        expect(partialDevice?.dependencyIds).toEqual([partialTrack?.commandId]);
        expect(partialParameter?.dependencyIds).toEqual([partialDevice?.commandId, partialTrack?.commandId]);
        expect(parsedPartial.envelope.batchLocalBindings).toEqual([]);
        expect(partialTrack?.arguments).toEqual(parsedPreview.envelope.commands[0]?.arguments);
        expect(partialDevice?.arguments).toEqual(parsedPreview.envelope.commands[1]?.arguments);
        expect(partialParameter?.arguments).toEqual(parsedPreview.envelope.commands[2]?.arguments);
        expect(partialTrack?.arguments).toMatchObject({
            id: expect.stringMatching(/^track-ai-/u),
            initialDeviceId: expect.stringMatching(/^device-command-/u),
        });
        expect(partialDevice?.arguments).toMatchObject({
            deviceId: expect.stringMatching(/^device-ai-/u),
            trackId: partialTrack?.arguments.id,
        });
        expect(partialParameter?.arguments).toMatchObject({ deviceId: partialDevice?.arguments.deviceId });
        preview.resource.release();

        const partialApproval = issueCommandApprovalBinding({
            authority: partial.authority,
            serialized: partial.serialized,
            validate: () => ({ status: 'valid' }),
        });
        await expect(
            executeVersionedCommandBatchEnvelope({
                authority: partial.authority,
                approvalBinding: partialApproval,
                serialized: partial.serialized,
            })
        ).resolves.toMatchObject({ status: 'committed' });
        const partiallyCreatedTrack = trackStore.value?.tracks[0];
        expect(partiallyCreatedTrack?.id).toBe(partialTrack?.arguments.id);
        expect(partiallyCreatedTrack?.devices.map((device) => device.id)).toEqual([
            partialTrack?.arguments.initialDeviceId,
            partialDevice?.arguments.deviceId,
        ]);
        expect(partiallyCreatedTrack?.devices[1]?.parameterValues).toMatchObject({ 'filter-type': 1 });
        expect(await undo()).toEqual({ headConsumed: true });
        expect(trackStore.value?.tracks).toEqual([]);

        const staleBatch = compileWorkflowCommandBatch(workflow, 'stale-project-revision', 'stale');

        await expect(executeVersionedCommandBatchEnvelope(staleBatch)).resolves.toMatchObject({
            status: 'conflicted',
            actions: [],
        });
        expect(JSON.stringify(trackStore.value)).not.toContain('track-ai-');

        const commandBatch = compileWorkflowCommandBatch(workflow, captureProjectRevision(), 'live');
        const committed = await executeVersionedCommandBatchEnvelope(commandBatch);
        if (committed.status !== 'committed') {
            const detail = 'reason' in committed ? `: ${committed.reason}` : '';
            throw new Error(`Expected live batch commit, received ${committed.status}${detail}`);
        }
        flushAutomergeStorageWrites();

        const createdTrack = trackStore.value?.tracks[0];
        const createdClip = createdTrack?.clips[0];
        const initialDevice = createdTrack?.devices[0];
        const createdDevice = createdTrack?.devices[1];
        const secondCreatedDevice = createdTrack?.devices[2];
        const createdNotes = midiStore.value?.notesByClipId[createdClip?.id ?? ''];
        expect(createdTrack).toMatchObject({
            id: expect.stringMatching(/^track-ai-/u),
            name: 'Lead',
            kind: 'midi',
        });
        expect(createdTrack?.clips.map((clip) => clip.id)).toEqual([createdClip?.id]);
        expect(createdClip).toMatchObject({
            id: expect.stringMatching(/^clip-ai-/u),
            name: 'Melody',
            startBeat: 0,
            endBeat: 4,
            type: 'midi',
        });
        expect(initialDevice).toMatchObject({
            id: expect.stringMatching(/^device-command-/u),
            name: 'Synth',
            type: 'builtin-synth',
        });
        expect(createdTrack?.devices.map((device) => device.id)).toEqual([
            initialDevice?.id,
            createdDevice?.id,
            secondCreatedDevice?.id,
        ]);
        expect(createdDevice).toMatchObject({
            id: expect.stringMatching(/^device-ai-/u),
            name: 'Filter',
            type: 'builtin-filter',
            parameterValues: {
                'filter-cutoff': 1000,
                'filter-resonance': 1,
                'filter-type': 1,
            },
        });
        expect(secondCreatedDevice).toMatchObject({
            id: expect.stringMatching(/^device-ai-/u),
            name: 'Filter',
            type: 'builtin-filter',
        });
        expect(secondCreatedDevice?.id).not.toBe(createdDevice?.id);
        expect(createdNotes).toEqual([
            {
                id: expect.stringMatching(/^note-/u),
                pitch: 60,
                startBeat: 0,
                duration: 1,
                velocity: 100,
                probability: 100,
            },
            {
                id: expect.stringMatching(/^note-/u),
                pitch: 67,
                startBeat: 1,
                duration: 1,
                velocity: 92,
                probability: 100,
            },
        ]);
        const committedTrack = structuredClone(createdTrack);
        const committedNotes = structuredClone(createdNotes);
        const automergeDocument = JSON.stringify(getCrdtDoc('root'));
        expect(automergeDocument).toContain(createdTrack?.id ?? '<missing-track>');
        expect(automergeDocument).toContain(createdDevice?.id ?? '<missing-device>');
        expect(automergeDocument).toContain(secondCreatedDevice?.id ?? '<missing-device>');
        expect(automergeDocument).toContain('"filter-type":1');

        expect(await undo()).toEqual({ headConsumed: true });
        expect(trackStore.value?.tracks).toEqual([]);
        expect(midiStore.value?.notesByClipId).not.toHaveProperty(createdClip?.id ?? '<missing-clip>');

        await redo();
        expect(trackStore.value?.tracks).toEqual([committedTrack]);
        expect(midiStore.value?.notesByClipId[createdClip?.id ?? '']).toEqual(committedNotes);
    });
});
