import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type readClipTransientOnsets } from '#/modules/ElasticAudio/useCases';

import { DEFAULT_AGENT_RESOURCE_LIMITS } from '../../models/AgentResourceLimits';
import { executeTransientOnsetRead } from '../executeTransientOnsetRead';

const mocks = vi.hoisted(() => ({
    readSource: vi.fn<typeof readClipTransientOnsets>(),
    revisionMatches: vi.fn<(revision: string) => boolean>(),
    projectId: vi.fn(),
    limits: vi.fn(),
}));

vi.mock('#/modules/ElasticAudio/useCases', () => ({ readClipTransientOnsets: mocks.readSource }));
vi.mock('#/modules/Project/stores', () => ({ getSettledProjectId: mocks.projectId }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: mocks.revisionMatches,
}));
vi.mock('../../stores/agentResourceLimitsStore', () => ({ readAgentResourceLimits: mocks.limits }));

const PROJECT_ID = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_REVISION = `revision:${'r'.repeat(20_000)}`;
const IDENTITY = {
    projectId: PROJECT_ID,
    clipId: 'clip-1',
    trackId: 'track-1',
    alternativeId: null,
    activeAlternative: true,
    bufferId: 'b'.repeat(64),
    sampleRate: 48_000,
    frameCount: 100_000,
    channelCount: 2,
};

function call(clipId = 'clip-1', cursor?: string, sensitivity?: number) {
    const argumentsValue: { clipId: string; cursor?: string; sensitivity?: number } = { clipId };
    if (cursor !== undefined) {
        argumentsValue.cursor = cursor;
    }
    if (sensitivity !== undefined) {
        argumentsValue.sensitivity = sensitivity;
    }
    return {
        call: {
            name: 'analysis.detectTransients',
            arguments: argumentsValue,
        },
        callId: 'call-1',
        turn: 1,
    };
}

function source(hits = [{ sampleOffset: 512, confidence: 0.75 }], isCurrent = () => true) {
    return { status: 'complete' as const, identity: IDENTITY, hits, isCurrent };
}

function session(input: { signal?: AbortSignal; admitted?: boolean } = {}) {
    const settle = vi.fn();
    const admit = vi.fn(() => {
        if (input.admitted === false) {
            return { status: 'refused' as const, category: 'localAnalysis' };
        }
        return { status: 'admitted' as const, settle };
    });
    return {
        ...executeTransientOnsetRead({ projectRevision: PROJECT_REVISION, signal: input.signal, admit }),
        admit,
        settle,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.projectId.mockReturnValue(PROJECT_ID);
    mocks.revisionMatches.mockReturnValue(true);
    mocks.limits.mockReturnValue(DEFAULT_AGENT_RESOURCE_LIMITS);
    mocks.readSource.mockResolvedValue(source());
});

describe('one planning run transient onset read', () => {
    it('reserves local analysis before accessing a source and settles actual work', async () => {
        let admitted = false;
        const settle = vi.fn();
        const admit = vi.fn(() => {
            admitted = true;
            return { status: 'admitted' as const, settle };
        });
        mocks.readSource.mockImplementation((sourceInput: { onAnalysisStarted: () => void }) => {
            expect(admitted).toBe(true);
            sourceInput.onAnalysisStarted();
            return Promise.resolve(source());
        });
        const reader = executeTransientOnsetRead({ projectRevision: PROJECT_REVISION, admit });

        const receipt = await reader.execute(call());

        expect(receipt.status).toBe('success');
        expect(admit).toHaveBeenCalledWith({ renderJobs: 0, analyses: 1 });
        expect(settle).toHaveBeenCalledExactlyOnceWith({ renderJobs: 0, analyses: 1 });
        expect(mocks.readSource).toHaveBeenCalledWith(
            expect.objectContaining({
                clipId: 'clip-1',
                sensitivity: 0.5,
                projectId: PROJECT_ID,
                isProjectRevisionCurrent: expect.any(Function),
                maxSourceSeconds: 600,
                maxChannelSamples: 10_000_000,
                timeoutMs: 120_000,
            })
        );
        reader.dispose();
    });

    it('binds source rechecks to the captured revision and reads current authority each time', async () => {
        const reader = session();
        await reader.execute(call());
        const sourceInput = mocks.readSource.mock.calls[0]?.[0];
        expect(sourceInput).toBeDefined();

        expect(sourceInput!.isProjectRevisionCurrent()).toBe(true);
        expect(mocks.revisionMatches).toHaveBeenLastCalledWith(PROJECT_REVISION);
        mocks.revisionMatches.mockReturnValue(false);
        expect(sourceInput!.isProjectRevisionCurrent()).toBe(false);
        expect(mocks.revisionMatches).toHaveBeenLastCalledWith(PROJECT_REVISION);
        expect(mocks.revisionMatches).toHaveBeenCalledTimes(2);
        reader.dispose();
    });

    it('refuses exhausted budget before the source cache is read', async () => {
        const reader = session({ admitted: false });

        const receipt = await reader.execute(call());

        expect(receipt).toMatchObject({ status: 'failure', error: { code: 'measurement-budget-exhausted' } });
        expect(mocks.readSource).not.toHaveBeenCalled();
        expect(reader.settle).not.toHaveBeenCalled();
        reader.dispose();
    });

    it('pages one immutable source detection with bounded numeric-only receipts and a fixed revision digest', async () => {
        const hits = Array.from({ length: 130 }, (_, index) => ({ sampleOffset: (index + 1) * 512, confidence: 0.5 }));
        mocks.readSource.mockResolvedValue(source(hits));
        const reader = session();

        const first = await reader.execute(call());
        const firstData = first.data as {
            hits: unknown[];
            nextCursor: string | null;
            complete: boolean;
            coverage: { offset: number; endOffset: number };
            sourceRevisionDigest: string;
        };
        expect(first).toMatchObject({
            status: 'success',
            toolName: 'analysis.detectTransients',
            revision: firstData.sourceRevisionDigest,
        });
        expect(firstData).toMatchObject({
            timeAxis: 'source-buffer',
            totalHitCount: 130,
            complete: false,
            coverage: { offset: 0, endOffset: 64 },
        });
        expect(firstData.hits).toHaveLength(64);
        expect(firstData.hits[0]).toEqual({ sourceSeconds: 512 / 48_000, confidence: 0.5 });
        expect(firstData.sourceRevisionDigest).toMatch(/^[0-9a-f]{64}$/u);
        expect(JSON.stringify(first)).not.toContain(PROJECT_REVISION);
        expect(JSON.stringify(first)).not.toMatch(/"(channels|samples|pcm|path|url)"/iu);
        expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThanOrEqual(16_384);

        const second = await reader.execute(call('clip-1', firstData.nextCursor!));
        const secondData = second.data as {
            hits: unknown[];
            nextCursor: string | null;
            coverage: { offset: number; endOffset: number };
        };
        expect(secondData).toMatchObject({ coverage: { offset: 64, endOffset: 128 } });
        expect(secondData.hits).toHaveLength(64);
        const third = await reader.execute(call('clip-1', secondData.nextCursor!));
        expect(third.data).toMatchObject({
            complete: true,
            nextCursor: null,
            coverage: { offset: 128, endOffset: 130 },
        });
        expect(mocks.readSource).toHaveBeenCalledTimes(1);
        expect(reader.admit).toHaveBeenCalledTimes(1);
        reader.dispose();
    });

    it('rejects cursor reuse, wrong clip, and changed sensitivity without new detection', async () => {
        mocks.readSource.mockResolvedValue(
            source(Array.from({ length: 65 }, (_, index) => ({ sampleOffset: index * 512, confidence: 1 })))
        );
        const reader = session();
        const first = await reader.execute(call());
        const cursor = (first.data as { nextCursor: string }).nextCursor;

        expect(await reader.execute(call('other', cursor))).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-cursor' },
        });
        expect(await reader.execute(call('clip-1', cursor, 0.9))).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-cursor' },
        });
        expect((await reader.execute(call('clip-1', cursor))).status).toBe('success');
        expect(await reader.execute(call('clip-1', cursor))).toMatchObject({
            status: 'failure',
            error: { code: 'invalid-cursor' },
        });
        expect(mocks.readSource).toHaveBeenCalledTimes(1);
        reader.dispose();
    });

    it('refuses a source that changed during detection and never caches it', async () => {
        let current = false;
        mocks.readSource.mockResolvedValue(source(undefined, () => current));
        const reader = session();

        expect(await reader.execute(call())).toMatchObject({ status: 'failure', error: { code: 'stale-source' } });
        current = true;
        expect(await reader.execute(call())).toMatchObject({ status: 'failure' });
        expect(mocks.readSource).toHaveBeenCalledTimes(1);
    });

    it('invalidates a later page when the clip or cached buffer has changed', async () => {
        let current = true;
        mocks.readSource.mockResolvedValue(
            source(
                Array.from({ length: 65 }, (_, index) => ({ sampleOffset: index * 512, confidence: 0.75 })),
                () => current
            )
        );
        const reader = session();
        const first = await reader.execute(call());
        current = false;

        expect(await reader.execute(call('clip-1', (first.data as { nextCursor: string }).nextCursor))).toMatchObject({
            status: 'failure',
            error: { code: 'stale-source' },
        });
        expect(mocks.readSource).toHaveBeenCalledTimes(1);
    });

    it('cancels an in-flight source, settles its reserved work and fences a late completion', async () => {
        let complete!: (result: ReturnType<typeof source>) => void;
        mocks.readSource.mockImplementation(
            () =>
                new Promise((resolve) => {
                    complete = resolve;
                })
        );
        const controller = new AbortController();
        const reader = session({ signal: controller.signal });
        const pending = reader.execute(call());
        expect(mocks.readSource).toHaveBeenCalledTimes(1);

        controller.abort();
        complete(source());
        expect(await pending).toMatchObject({ status: 'failure', error: { code: 'cancelled' } });
        expect(reader.settle).toHaveBeenCalledTimes(1);
        expect(await reader.execute(call())).toMatchObject({ status: 'failure', error: { code: 'cancelled' } });
        expect(mocks.readSource).toHaveBeenCalledTimes(1);
    });

    it('refuses malformed arguments and absent project identity without reserving work', async () => {
        const reader = session();
        expect(
            await reader.execute({
                ...call(),
                call: { name: 'analysis.detectTransients', arguments: { clipId: 'clip-1', extra: true } },
            })
        ).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-arguments' } });
        expect(
            await reader.execute({ ...call(), call: { name: 'detectTransients', arguments: { clipId: 'clip-1' } } })
        ).toMatchObject({ status: 'failure', error: { code: 'invalid-tool-name' } });
        reader.dispose();
        mocks.projectId.mockReturnValue(undefined);
        const unavailable = session();
        expect(await unavailable.execute(call())).toMatchObject({ status: 'failure', error: { code: 'stale-source' } });
        expect(mocks.readSource).not.toHaveBeenCalled();
        unavailable.dispose();
    });

    it('settles zero analyses when the source refuses before starting its worker', async () => {
        mocks.readSource.mockResolvedValue({ status: 'failed', code: 'missing-buffer' });
        const reader = session();

        expect(await reader.execute(call())).toMatchObject({ status: 'failure', error: { code: 'missing-buffer' } });
        expect(reader.settle).toHaveBeenCalledExactlyOnceWith({ renderJobs: 0, analyses: 0 });
        reader.dispose();
    });

    it('keeps a worst-size page below the 16 KiB wire limit', async () => {
        const longId = 'x'.repeat(256);
        mocks.projectId.mockReturnValue(longId);
        const worstIdentity = {
            ...IDENTITY,
            projectId: longId,
            clipId: longId,
            trackId: longId,
            alternativeId: longId,
            bufferId: 'f'.repeat(64),
            sampleRate: 1,
            frameCount: 10_000_000,
            channelCount: 1,
        };
        mocks.readSource.mockResolvedValue({
            status: 'complete',
            identity: worstIdentity,
            hits: Array.from({ length: 65 }, (_, index) => ({
                sampleOffset: index * 512,
                confidence: Number.MIN_VALUE,
            })),
            isCurrent: () => true,
        });
        const reader = session();

        const receipt = await reader.execute({ ...call(longId), callId: 'i'.repeat(256) });

        expect(receipt.status).toBe('success');
        expect((receipt.data as { hits: unknown[] }).hits).toHaveLength(64);
        expect(new TextEncoder().encode(JSON.stringify(receipt)).byteLength).toBeLessThanOrEqual(16_384);
        reader.dispose();
    });
});
