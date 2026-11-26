import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

await vi.hoisted(async () => {
    const { createMockAudioContext, createMockAudioNode } = await import('#/helpers/__tests__/audioContext.mock');
    // The engine mutes a disabled track's strip, which needs a context to build the strip on.
    vi.stubGlobal('AudioContext', createMockAudioContext);
    vi.stubGlobal('AudioWorkletNode', function MockAudioWorkletNode(this: object) {
        Object.assign(this, createMockAudioNode('audio-worklet'));
    });
});

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    commandBatchPreflightPort,
    commandProjectRevisionPort,
    configureCommandBatchIdempotency,
    compileVersionedCommandBatchEnvelope,
    executeVersionedCommandBatchEnvelope,
    issueCommandApprovalBinding,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    resetActionReplayAuthority,
    serializeVersionedCommandEnvelope,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    captureProjectRevision,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function readTrack(trackId: string) {
    return trackStore.value?.tracks.find((track) => track.id === trackId);
}

async function runDisableThroughEnvelope(trackId: string, disabled: boolean, key: string) {
    const baseRevision = captureProjectRevision();
    commandProjectRevisionPort.setProvider(() => baseRevision);
    commandBatchPreflightPort.setProvider(({ targetIds }) => ({
        audioGraphValid: true,
        availableAssetHashes: [],
        availableAudioBufferIds: [],
        lockedRanges: [],
        projectId: `project-${key}`,
        projectInvariantsValid: true,
        targetFingerprints: Object.fromEntries(targetIds.map((targetId) => [targetId, `present:${targetId}`])),
    }));
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action: { type: 'disableTrack', payload: { trackId, disabled } },
        normalizedProjectRevision: baseRevision,
    });
    const batch = compileVersionedCommandBatchEnvelope({
        baseRevision,
        batchId: `batch-${key}`,
        commands: [serializeVersionedCommandEnvelope(command)],
        intent: 'Disable a track',
        mode: 'commit',
        projectId: `project-${key}`,
        runId: `run-${key}`,
    });
    return executeVersionedCommandBatchEnvelope({
        approvalBinding: issueCommandApprovalBinding({
            authority: batch.authority,
            serialized: batch.serialized,
            validate: () => ({ status: 'valid' }),
        }),
        authority: batch.authority,
        serialized: batch.serialized,
    });
}

describe('disableTrack through the versioned envelope route', () => {
    beforeEach(() => {
        Container.clear();
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
            },
        });
        configureCommandBatchIdempotency({ canExecute: () => true });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('disable track envelope route');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: 'master', name: 'Master', kind: 'master' }),
                TrackDummy.create({ id: 'track-1' }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        commandProjectRevisionPort.setProvider(null);
        localStorage.removeItem('sourdaw:command-batch-idempotency:v1');
        vi.unstubAllGlobals();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        configureAutomergeStoragePort(null);
        Container.clear();
    });

    it('disables an ordinary track', async () => {
        const result = await runDisableThroughEnvelope('track-1', true, 'ordinary');

        expect(result).toMatchObject({ status: 'committed' });
        expect(readTrack('track-1')?.disabled).toBe(true);
    });

    it('refuses to disable the master track and leaves it unchanged', async () => {
        const result = await runDisableThroughEnvelope('master', true, 'master');

        expect(result).toMatchObject({ status: 'conflicted' });
        expect(JSON.stringify(result)).toContain('The master track cannot be disabled');
        expect(readTrack('master')?.disabled).toBe(false);
    });
});
