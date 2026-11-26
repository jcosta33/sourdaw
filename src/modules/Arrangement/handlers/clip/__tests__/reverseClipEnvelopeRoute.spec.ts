import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { cacheAudioBuffer, getCachedAudioBuffer } from '#/modules/AudioEngine/useCases';
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

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const SAMPLE_RATE = 48_000;
const FRAMES = 96_000;

function createFakeBuffer(): AudioBuffer {
    const channel = Float32Array.from({ length: FRAMES }, (_, index) => index);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the reverse reads only these members
    return {
        length: FRAMES,
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        duration: FRAMES / SAMPLE_RATE,
        getChannelData: () => channel,
    } as unknown as AudioBuffer;
}

function readClip(clipId: string) {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
}

function existsInProject(id: string): boolean {
    return (
        trackStore.value?.tracks.some((track) => track.id === id || track.clips.some((clip) => clip.id === id)) ?? false
    );
}

/** Only buffers the cache holds are available, as in production preflight. */
function cachedBufferIds(): string[] {
    return ['loaded', 'foreign', 'unloaded'].filter((bufferId) => getCachedAudioBuffer({ bufferId }) !== null);
}

async function reverseThroughEnvelope(clipId: string, key: string, reversedBufferId?: string) {
    const baseRevision = captureProjectRevision();
    commandProjectRevisionPort.setProvider(() => baseRevision);
    commandBatchPreflightPort.setProvider(({ targetIds }) => ({
        audioGraphValid: true,
        availableAssetHashes: [],
        availableAudioBufferIds: cachedBufferIds(),
        lockedRanges: [],
        projectId: `project-${key}`,
        projectInvariantsValid: true,
        targetFingerprints: Object.fromEntries(
            targetIds.filter(existsInProject).map((targetId) => [targetId, `present:${targetId}`])
        ),
    }));
    const payload: { clipId: string; reversedBufferId?: string } = { clipId };
    if (reversedBufferId !== undefined) {
        payload.reversedBufferId = reversedBufferId;
    }
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action: { type: 'reverseClip', payload },
        normalizedProjectRevision: baseRevision,
    });
    const batch = compileVersionedCommandBatchEnvelope({
        baseRevision,
        batchId: `batch-${key}`,
        commands: [serializeVersionedCommandEnvelope(command)],
        intent: 'Reverse a clip',
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

type EnvelopeResult = Awaited<ReturnType<typeof reverseThroughEnvelope>>;

/** The status, and the refusal reason when the route gave one, without the receipt around them. */
function outcomeOf(result: EnvelopeResult): { status: string; reason?: string } {
    return 'reason' in result ? { status: result.status, reason: result.reason } : { status: result.status };
}

function seedProject(): void {
    trackStore.set({
        tracks: [
            TrackDummy.create({ id: 'master', name: 'Master', kind: 'master' }),
            TrackDummy.create({
                id: 'audio-1',
                kind: 'audio',
                clips: [
                    ClipDummy.create({ id: 'verse', trackId: 'audio-1', name: 'Verse', audioBufferId: 'loaded' }),
                    ClipDummy.create({
                        id: 'locked',
                        trackId: 'audio-1',
                        audioBufferId: 'loaded',
                        locked: true,
                    }),
                    ClipDummy.create({ id: 'unloaded', trackId: 'audio-1', audioBufferId: 'unloaded' }),
                    ClipDummy.create({ id: 'other', trackId: 'audio-1', name: 'Other', audioBufferId: 'foreign' }),
                    ClipDummy.create({
                        id: 'looped',
                        trackId: 'audio-1',
                        audioBufferId: 'loaded',
                        loopEnabled: true,
                        loopLength: 2,
                        audioOffsetSeconds: 0.5,
                    }),
                ],
            }),
            TrackDummy.create({
                id: 'frozen-audio',
                kind: 'audio',
                frozen: true,
                clips: [ClipDummy.create({ id: 'frozen-clip', trackId: 'frozen-audio', audioBufferId: 'loaded' })],
            }),
            TrackDummy.create({
                id: 'midi-1',
                kind: 'midi',
                clips: [ClipDummy.create({ id: 'notes', trackId: 'midi-1', type: 'midi', audioBufferId: undefined })],
            }),
        ],
        selectedTrackId: null,
        ghostClips: [],
    });
    flushAutomergeStorageWrites();
}

describe('reverseClip through the versioned envelope route', () => {
    beforeEach(() => {
        Container.clear();
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
            },
        });
        vi.stubGlobal(
            'OfflineAudioContext',
            class {
                createBuffer(): AudioBuffer {
                    return createFakeBuffer();
                }
            }
        );
        configureCommandBatchIdempotency({ canExecute: () => true });
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('reverse clip envelope route');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        cacheAudioBuffer({ buffer: createFakeBuffer(), bufferId: 'loaded' });
        cacheAudioBuffer({ buffer: createFakeBuffer(), bufferId: 'foreign' });
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

    it('reverses an audio clip onto a buffer minted for the command', async () => {
        const result = await reverseThroughEnvelope('verse', 'ok');

        expect(outcomeOf(result)).toEqual({ status: 'committed' });
        expect(readClip('verse')).toMatchObject({ name: 'Verse (reversed)' });
        expect(readClip('verse')?.audioBufferId).toMatch(/^reversed-command-/);
    });

    it.each([
        ['a clip that does not exist', 'ghost', 'rejected', 'Command batch target does not exist: ghost'],
        ['a locked clip', 'locked', 'conflicted', 'Clip "locked" is locked'],
        ['a clip on a frozen track', 'frozen-clip', 'conflicted', 'Track "frozen-audio" is frozen'],
        // Describe has no exact inverse for these, so the route refuses them before validation runs.
        [
            'a MIDI clip, which has no compensable inverse',
            'notes',
            'rejected',
            'Action is not compensable inside an atomic batch: reverseClip',
        ],
        [
            'a looping clip, which has no compensable inverse',
            'looped',
            'rejected',
            'Action is not compensable inside an atomic batch: reverseClip',
        ],
        ['a clip whose audio is not loaded', 'unloaded', 'conflicted', 'The audio of clip "unloaded" is not loaded'],
    ])('refuses to reverse %s and writes nothing', async (_name, clipId, status, reason) => {
        const before = JSON.stringify(trackStore.value);

        const result = await reverseThroughEnvelope(clipId, `refuse-${clipId}`);

        expect(outcomeOf(result)).toEqual({ status, reason: expect.stringContaining(reason) });
        expect(JSON.stringify(trackStore.value)).toBe(before);
    });

    it.each([
        ['the clip’s own buffer', 'verse', 'loaded'],
        ['another clip’s buffer', 'verse', 'foreign'],
    ])(
        'refuses a supplied reversed buffer id naming %s, leaving the cache and clip unchanged',
        async (_name, clipId, bufferId) => {
            const cachedBefore = getCachedAudioBuffer({ bufferId });
            const clipBefore = JSON.stringify(readClip(clipId));

            const result = await reverseThroughEnvelope(clipId, `supplied-${bufferId}`, bufferId);

            expect(outcomeOf(result)).toEqual({
                status: 'conflicted',
                reason: expect.stringContaining(`Audio buffer "${bufferId}" already exists`),
            });
            expect(getCachedAudioBuffer({ bufferId })).toBe(cachedBefore);
            expect(JSON.stringify(readClip(clipId))).toBe(clipBefore);
        }
    );
});
