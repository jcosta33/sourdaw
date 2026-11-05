import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    compileVersionedCommandBatchEnvelope,
    executeVersionedCommandBatchEnvelope,
    finalizeRecoveredCommandBatchEffects,
    issueCommandApprovalBinding,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    resetActionReplayAuthority,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectIdentity,
    captureProjectRevision,
    createCrdtDoc,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import {
    arrangementStore,
    defaultArrangementId,
    defaultProjectStoreState,
    projectStore,
} from '#/modules/Project/stores';
import { buildProjectData } from '#/modules/Project/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from '../../__tests__/aiWorkflowCommandPreflightFixture';

// Finalization here is the real `finalizeRecoveredCommandBatchEffects`, with the Command revision
// port wired as `aiWorkflowCommandCheckpointRuntime` wires it (the bootstrap wiring), over a real CRDT
// document and a real save write.
type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function createTrack(): Track {
    return {
        id: 'track-kick',
        name: 'Kick',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function seedProject(): void {
    trackStore.set({ tracks: [createTrack()], selectedTrackId: 'track-kick', ghostClips: [] });
    arrangementStore.set({
        activeArrangementId: defaultArrangementId,
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
    });
    flushAutomergeStorageWrites();
}

/** A gain write whose runtime effect fails after the project commit, leaving a pending-effect receipt. */
function registerGainHandlerWithFailingRuntimeEffect(): void {
    mutateCrdtDoc<{ trackGain: { value: number } }>({
        id: 'root',
        changeFn: (document) => {
            document.trackGain = { value: 1 };
        },
    });
    const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
    expect(gainStorage.hydrate?.()).toBe(true);
    const handler: ActionHandler<SetTrackGainAction> = {
        canReapplyAfterDivergence: () => true,
        describe: () => ({
            inverseAction: {
                type: 'setTrackGain',
                payload: { trackId: 'track-kick', gain: 1, expectedGain: 0.8 },
            },
            label: 'Set kick gain',
        }),
        execute: () => {
            gainStorage.set({ value: 0.8 });
            const runtimeEffect = () => Promise.reject(new Error('runtime strip unavailable'));
            return { status: 'written', afterCommit: runtimeEffect, afterAmbiguousCommit: runtimeEffect };
        },
        previewExecution: 'isolated-project',
        undoable: true,
        validate: () => true,
    };
    registerHandlerMap({ setTrackGain: handler });
}

/** The root writes `saveProject` performs: a fresh save timestamp, then `buildProjectData`'s arrangement refresh. */
async function writeSave(): Promise<void> {
    const project = projectStore.value ?? defaultProjectStoreState;
    projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000, dirty: true });
    await buildProjectData({ includeAudioBuffers: false });
    flushAutomergeStorageWrites();
}

function setKickName(name: string): void {
    const tracks = trackStore.value?.tracks ?? [];
    trackStore.set({
        tracks: tracks.map((track) => ({ ...track, name })),
        selectedTrackId: 'track-kick',
        ghostClips: [],
    });
}

function writeKickName(name: string): void {
    setKickName(name);
    flushAutomergeStorageWrites();
}

/** A rename whose document write still waits on its animation frame, as in a background window. */
function renameKickBeforeItsFrame(name: string): void {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    setKickName(name);
}

async function commitBatchWithPendingEffect() {
    const baseRevision = captureProjectRevision();
    const action: SetTrackGainAction = {
        type: 'setTrackGain',
        payload: { trackId: 'track-kick', gain: 0.8, expectedGain: 1 },
    };
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action,
        expectedEffect: 'Set the kick gain.',
        normalizedProjectRevision: baseRevision,
        options: { groupId: 'batch-finalize', groupLabel: 'Kick gain', source: 'prompt' },
    });
    const batch = compileVersionedCommandBatchEnvelope({
        baseRevision,
        batchId: 'batch-finalize',
        commands: [serializeVersionedCommandEnvelope(command)],
        idempotencyKey: 'client-request-finalize',
        intent: 'Set kick gain',
        mode: 'commit',
        projectId: captureProjectIdentity(),
        runId: 'run-finalize',
    });
    const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const first = await executeVersionedCommandBatchEnvelope({
        authority: batch.authority,
        serialized: batch.serialized,
        approvalBinding: issueCommandApprovalBinding({
            authority: batch.authority,
            serialized: batch.serialized,
            validate: () => ({ status: 'valid' }),
        }),
    });
    if (first.status !== 'committed-with-warning') {
        throw new Error(`Expected a pending-effect receipt, got ${first.status}`);
    }
    return { batch, receipt: first.receipt, committedRevision: captureProjectRevision() };
}

registerSupportingServicePorts();

describe('Finalizing recovered command effects after a save', () => {
    beforeEach(() => {
        configureAiWorkflowCommandPreflightFixture();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('finalize after save test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        agentProjectRepairStateStore.set(null);
        projectStore.set(defaultProjectStoreState);
        seedProject();
        registerGainHandlerWithFailingRuntimeEffect();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        vi.unstubAllGlobals();
        resetAiWorkflowCommandPreflightFixture();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        projectStore.set(defaultProjectStoreState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('finalizes against the committed revision after a save', async () => {
        const { batch, receipt, committedRevision } = await commitBatchWithPendingEffect();

        await writeSave();
        expect(captureProjectRevision()).not.toBe(committedRevision);

        const result = await finalizeRecoveredCommandBatchEffects({
            authority: batch.authority,
            serialized: batch.serialized,
            pendingReceipt: receipt,
            expectedProjectRevision: committedRevision,
        });

        expect(result.status).toBe('finalized');
    });

    it('still refuses to finalize after a content edit, saved or not', async () => {
        const { batch, receipt, committedRevision } = await commitBatchWithPendingEffect();

        writeKickName('Kick 2');
        await writeSave();

        await expect(
            finalizeRecoveredCommandBatchEffects({
                authority: batch.authority,
                serialized: batch.serialized,
                pendingReceipt: receipt,
                expectedProjectRevision: committedRevision,
            })
        ).resolves.toEqual({
            status: 'failed',
            disposition: 'manual-repair',
            reason: 'The project changed before external-effect finalization',
        });
    });

    it('refuses to finalize after a content edit that has not reached the document yet', async () => {
        const { batch, receipt, committedRevision } = await commitBatchWithPendingEffect();

        renameKickBeforeItsFrame('Kick 2');
        expect(captureProjectRevision()).toBe(committedRevision);

        await expect(
            finalizeRecoveredCommandBatchEffects({
                authority: batch.authority,
                serialized: batch.serialized,
                pendingReceipt: receipt,
                expectedProjectRevision: committedRevision,
            })
        ).resolves.toEqual({
            status: 'failed',
            disposition: 'manual-repair',
            reason: 'The project changed before external-effect finalization',
        });
    });
});
