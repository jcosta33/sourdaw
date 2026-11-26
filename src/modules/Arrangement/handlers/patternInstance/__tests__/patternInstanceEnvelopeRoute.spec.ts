import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function readClip(clipId: string) {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
}

function clipCount(): number {
    return trackStore.value?.tracks.flatMap((track) => track.clips).length ?? 0;
}

/** A target has a fingerprint only while the project holds it, as in production preflight. */
function existsInProject(id: string): boolean {
    return (
        trackStore.value?.tracks.some((track) => track.id === id || track.clips.some((clip) => clip.id === id)) ?? false
    );
}

async function runThroughEnvelope(action: AppAction, key: string) {
    const baseRevision = captureProjectRevision();
    commandProjectRevisionPort.setProvider(() => baseRevision);
    commandBatchPreflightPort.setProvider(({ targetIds }) => ({
        audioGraphValid: true,
        availableAssetHashes: [],
        availableAudioBufferIds: [],
        lockedRanges: [],
        projectId: `project-${key}`,
        projectInvariantsValid: true,
        targetFingerprints: Object.fromEntries(
            targetIds.filter(existsInProject).map((targetId) => [targetId, `present:${targetId}`])
        ),
    }));
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action,
        normalizedProjectRevision: baseRevision,
    });
    const batch = compileVersionedCommandBatchEnvelope({
        baseRevision,
        batchId: `batch-${key}`,
        commands: [serializeVersionedCommandEnvelope(command)],
        intent: 'Edit a pattern instance',
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

type EnvelopeResult = Awaited<ReturnType<typeof runThroughEnvelope>>;

/** The status, and the refusal reason when the route gave one, without the receipt around them. */
function outcomeOf(result: EnvelopeResult): { status: string; reason?: string } {
    return 'reason' in result ? { status: result.status, reason: result.reason } : { status: result.status };
}

function seedProject(): void {
    trackStore.set({
        tracks: [
            TrackDummy.create({ id: 'master', name: 'Master', kind: 'master' }),
            TrackDummy.create({
                id: 'midi-1',
                kind: 'midi',
                clips: [
                    ClipDummy.create({ id: 'pattern', trackId: 'midi-1', type: 'midi', audioBufferId: undefined }),
                    ClipDummy.create({
                        id: 'instance',
                        trackId: 'midi-1',
                        type: 'midi',
                        audioBufferId: undefined,
                        parentClipId: 'pattern',
                        overrides: {},
                    }),
                    ClipDummy.create({
                        id: 'locked-instance',
                        trackId: 'midi-1',
                        type: 'midi',
                        audioBufferId: undefined,
                        parentClipId: 'pattern',
                        overrides: {},
                        locked: true,
                    }),
                ],
            }),
            TrackDummy.create({
                id: 'audio-1',
                kind: 'audio',
                clips: [ClipDummy.create({ id: 'sample', trackId: 'audio-1' })],
            }),
            TrackDummy.create({
                id: 'frozen-midi',
                kind: 'midi',
                frozen: true,
                clips: [
                    ClipDummy.create({
                        id: 'frozen-instance',
                        trackId: 'frozen-midi',
                        type: 'midi',
                        audioBufferId: undefined,
                        parentClipId: 'pattern',
                        overrides: {},
                    }),
                ],
            }),
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

describe('pattern instance commands through the versioned envelope route', () => {
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
        resetCrdtProjectAuthority('pattern instance envelope route');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        seedProject();
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

    it('detaches a linked instance', async () => {
        const result = await runThroughEnvelope(
            { type: 'detachPatternInstance', payload: { clipId: 'instance' } },
            'd'
        );

        expect(outcomeOf(result)).toEqual({ status: 'committed' });
        expect(readClip('instance')?.parentClipId).toBeUndefined();
    });

    it.each([
        ['a clip that does not exist', 'ghost', 'rejected', 'Command batch target does not exist: ghost'],
        ['a locked clip', 'locked-instance', 'conflicted', 'Clip "locked-instance" is locked'],
        ['a clip on a frozen track', 'frozen-instance', 'conflicted', 'Track "frozen-midi" is frozen'],
    ])('refuses to detach %s and writes nothing', async (_name, clipId, status, reason) => {
        const result = await runThroughEnvelope({ type: 'detachPatternInstance', payload: { clipId } }, `d-${clipId}`);

        expect(outcomeOf(result)).toEqual({ status, reason: expect.stringContaining(reason) });
        expect(readClip('locked-instance')?.parentClipId).toBe('pattern');
        expect(readClip('frozen-instance')?.parentClipId).toBe('pattern');
        expect(readClip('instance')?.parentClipId).toBe('pattern');
    });

    it.each([
        [
            'a source clip that does not exist',
            { sourceClipId: 'ghost' },
            'rejected',
            'Command batch target does not exist: ghost',
        ],
        [
            'an audio source clip',
            { sourceClipId: 'sample' },
            'conflicted',
            'Clip "sample" is not a MIDI clip, so it has no pattern to instance',
        ],
        [
            'an audio destination track',
            { targetTrackId: 'audio-1' },
            'conflicted',
            'Track "audio-1" is not a MIDI track, so it cannot host a pattern instance',
        ],
        ['a frozen destination track', { targetTrackId: 'frozen-midi' }, 'conflicted', 'Track "frozen-midi" is frozen'],
        [
            'a destination track that does not exist',
            { targetTrackId: 'ghost' },
            'rejected',
            'Command batch target does not exist: ghost',
        ],
    ])('refuses to instance %s and writes nothing', async (_name, overrides, status, reason) => {
        const before = clipCount();
        const result = await runThroughEnvelope(
            {
                type: 'createPatternInstance',
                payload: { sourceClipId: 'pattern', targetTrackId: 'midi-1', startBeat: 8, ...overrides },
            },
            `c-${reason.length}`
        );

        expect(outcomeOf(result)).toEqual({ status, reason: expect.stringContaining(reason) });
        expect(clipCount()).toBe(before);
    });

    it('refuses a negative start beat before it compiles, writing nothing', async () => {
        const before = clipCount();

        await expect(
            runThroughEnvelope(
                {
                    type: 'createPatternInstance',
                    payload: { sourceClipId: 'pattern', targetTrackId: 'midi-1', startBeat: -4 },
                },
                'c-negative'
            )
        ).rejects.toThrow('Command batch scope is malformed');
        expect(clipCount()).toBe(before);
    });

    it('instances a MIDI clip onto a MIDI track under a minted id', async () => {
        const before = clipCount();
        const result = await runThroughEnvelope(
            {
                type: 'createPatternInstance',
                payload: { sourceClipId: 'pattern', targetTrackId: 'midi-1', startBeat: 8 },
            },
            'c-ok'
        );

        expect(outcomeOf(result)).toEqual({ status: 'committed' });
        expect(clipCount()).toBe(before + 1);
        const created = trackStore.value?.tracks
            .flatMap((track) => track.clips)
            .find((clip) => clip.parentClipId === 'pattern' && clip.startBeat === 8);
        expect(created?.id).toMatch(/^clip-inst-/);
    });
});
