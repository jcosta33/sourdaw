import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandTrackDefaultsPort,
    executeVersionedCommandBatchEnvelope,
    issueCommandApprovalBinding,
    parseVersionedCommandBatchEnvelope,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { tryCompoundFastPath, tryParameterizedPath, tryPresetMatch } from '../../transformers/promptParser/parsing';
import { compilePlannedActionCommandBatch } from '../compilePlannedActionCommandBatch';
import { getProjectContext } from '../getProjectContext';
import { generateToolPlanningOutcome } from '../llmOrchestration/inference';
import { parsePromptToActions } from '../parsePromptToActions';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const runtimeMocks = vi.hoisted(() => ({
    setTrackGain: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSoloGate: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackGain: runtimeMocks.setTrackGain,
    setTrackMute: runtimeMocks.setTrackMute,
    setTrackSoloGate: runtimeMocks.setTrackSoloGate,
}));

vi.mock('../llmOrchestration/inference', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../llmOrchestration/inference')>()),
    generateToolPlanningOutcome: vi.fn(),
}));

vi.mock('../../transformers/promptParser/parsing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../transformers/promptParser/parsing')>()),
    tryPresetMatch: vi.fn(),
    tryParameterizedPath: vi.fn(),
    tryCompoundFastPath: vi.fn(),
}));

const prompt = 'mute Keys MIDI track, then mute Drums MIDI track';
const document = {
    schemaVersion: 1,
    name: 'mute-keys',
    seed: 1,
    variables: {},
    selectors: {},
    steps: [
        {
            id: 'mute-keys',
            kind: 'emit',
            operation: 'muteTrack',
            arguments: {
                trackId: { literal: 'track-keys' },
                muted: { literal: true },
            },
        },
        {
            id: 'mute-drums',
            kind: 'emit',
            operation: 'muteTrack',
            arguments: {
                trackId: { literal: 'track-drums' },
                muted: { literal: true },
            },
        },
    ],
    assertions: [],
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('transform.compile Command approval', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('transform.compile approval test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        configureAiWorkflowCommandPreflightFixture();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        commandTrackDefaultsPort.setTrackColorProvider(() => '#456789');
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        trackStore.set({
            tracks: [
                createTrack({ id: 'track-keys', name: 'Keys', kind: 'midi' }),
                createTrack({ id: 'track-drums', name: 'Drums', kind: 'midi' }),
            ],
            selectedTrackId: 'track-keys',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        clearUndoHistory();
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        resetAiWorkflowCommandPreflightFixture();
        commandTrackDefaultsPort.setTrackColorProvider(null);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('previews without mutation, commits on approval, and undoes the selected transform', async () => {
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [{ id: 'compile-1', name: 'transform.compile', arguments: { document } }],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'propose-1',
                        name: 'command.batch.propose',
                        arguments: { commands: [], compiledCallIds: ['compile-1'] },
                    },
                ],
            });

        const revision = captureProjectRevision();
        const context = getProjectContext();
        const parsed = await parsePromptToActions(prompt, context, undefined, revision);
        expect(parsed.rejectionReason).toBeUndefined();
        expect(parsed.actions).toHaveLength(2);
        expect(parsed.actions[0]).toMatchObject({ type: 'muteTrack', payload: { trackId: 'track-keys', muted: true } });
        expect(parsed.actions[1]).toMatchObject({
            type: 'muteTrack',
            payload: { trackId: 'track-drums', muted: true },
        });
        expect(parsed.requiresConfirmation).toBe(true);
        expect(trackStore.value?.tracks[0]?.muted).toBe(false);
        expect(trackStore.value?.tracks[1]?.muted).toBe(false);
        expect(undoStore.value?.past).toEqual([]);

        const commandBatch = compilePlannedActionCommandBatch({
            actions: parsed.actions,
            actionCommandGraph: parsed.actionCommandGraph,
            actionLabels: ['muteTrack', 'muteTrack'],
            autoCommit: false,
            context,
            group: { groupId: 'group-transform-approval', groupLabel: 'Mute Keys' },
            intent: prompt,
            mode: 'commit',
            projectRevision: revision,
            runId: 'run-transform-approval',
        }).commandBatch;
        const preview = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        expect(preview.status).toBe('valid');
        expect(trackStore.value?.tracks[0]?.muted).toBe(false);
        expect(trackStore.value?.tracks[1]?.muted).toBe(false);
        expect(undoStore.value?.past).toEqual([]);

        const approvalBinding = issueCommandApprovalBinding({
            authority: commandBatch.authority,
            serialized: commandBatch.serialized,
            validate: () => ({ status: 'valid' }),
        });
        const committed = await executeVersionedCommandBatchEnvelope({
            ...commandBatch,
            approvalBinding,
        });
        expect(committed.status).toBe('committed');
        expect(trackStore.value?.tracks[0]?.muted).toBe(true);
        expect(trackStore.value?.tracks[1]?.muted).toBe(true);
        expect(undoStore.value?.past).toHaveLength(2);

        expect(await undo()).toEqual({ headConsumed: true });
        expect(trackStore.value?.tracks[0]?.muted).toBe(false);
        expect(trackStore.value?.tracks[1]?.muted).toBe(false);
    });

    it('keeps a compiled track and clip unwritten until approval, then undoes their one batch', async () => {
        const creationDocument = {
            ...document,
            name: 'create-lead-clip',
            steps: [
                {
                    id: 'lead',
                    kind: 'emit',
                    operation: 'addTrack',
                    binding: 'lead',
                    arguments: {
                        name: { literal: 'Lead' },
                        kind: { literal: 'midi' },
                    },
                },
                {
                    id: 'lead-clip',
                    kind: 'emit',
                    operation: 'addClip',
                    dependsOn: ['lead'],
                    arguments: {
                        trackId: { bindingRef: 'lead' },
                        name: { literal: 'Lead Take' },
                        startBeat: { literal: 2 },
                        endBeat: { literal: 6 },
                    },
                },
            ],
        };
        vi.mocked(generateToolPlanningOutcome)
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    { id: 'compile-creation', name: 'transform.compile', arguments: { document: creationDocument } },
                ],
            })
            .mockResolvedValueOnce({
                status: 'complete',
                toolCalls: [
                    {
                        id: 'propose-creation',
                        name: 'command.batch.propose',
                        arguments: { commands: [], compiledCallIds: ['compile-creation'] },
                    },
                ],
            });
        const creationPrompt =
            'create a MIDI track named Lead and add a MIDI clip named Lead Take on that new track from beat 2 to beat 6';
        const revision = captureProjectRevision();
        const context = getProjectContext();
        const parsed = await parsePromptToActions(creationPrompt, context, undefined, revision);
        expect(parsed.rejectionReason).toBeUndefined();
        expect(parsed.actions.map((action) => action.type)).toEqual(['addTrack', 'addClip']);
        expect(parsed.requiresConfirmation).toBe(true);
        expect(parsed.actionCommandGraph).toMatchObject({
            dependenciesByActionIndex: [[], [0]],
            batchLocalBindings: [{ bindingId: '$lead', producerActionIndex: 0, producerArgument: 'id' }],
        });
        expect(trackStore.value?.tracks).toHaveLength(2);
        expect(undoStore.value?.past).toEqual([]);

        const commandBatch = compilePlannedActionCommandBatch({
            actions: parsed.actions,
            actionCommandGraph: parsed.actionCommandGraph,
            actionLabels: ['addTrack', 'addClip'],
            autoCommit: false,
            context,
            group: { groupId: 'group-transform-creation', groupLabel: 'Create Lead clip' },
            intent: creationPrompt,
            mode: 'commit',
            projectRevision: revision,
            runId: 'run-transform-creation',
        }).commandBatch;
        const preview = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        expect(preview.status).toBe('valid');
        expect(trackStore.value?.tracks).toHaveLength(2);
        expect(undoStore.value?.past).toEqual([]);

        const approvalBinding = issueCommandApprovalBinding({
            authority: commandBatch.authority,
            serialized: commandBatch.serialized,
            validate: () => ({ status: 'valid' }),
        });
        const committed = await executeVersionedCommandBatchEnvelope({ ...commandBatch, approvalBinding });
        expect(committed.status, 'reason' in committed ? committed.reason : '').toBe('committed');
        const lead = trackStore.value?.tracks.find((track) => track.name === 'Lead');
        expect(lead?.clips.map((clip) => clip.name)).toEqual(['Lead Take']);
        expect(undoStore.value?.past).toHaveLength(2);

        expect(await undo()).toEqual({ headConsumed: true });
        expect(trackStore.value?.tracks).toHaveLength(2);
        expect(trackStore.value?.tracks.some((track) => track.name === 'Lead')).toBe(false);
    });
});
