import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { AGENT_SECTION_RENDER_RETENTION_POLICY } from '../../models/AgentSectionRenderRetentionPolicy';
import { clearAgentSectionRenderArtifacts } from '../clearAgentSectionRenderArtifacts';
import { getAgentSectionRenderArtifacts } from '../getAgentSectionRenderArtifacts';
import { renderAgentProjectSections } from '../renderAgentProjectSections';
import { wouldAgentSectionRenderSetExceedRetention } from '../wouldAgentSectionRenderSetExceedRetention';

const mocks = vi.hoisted(() => ({
    cancelExport: vi.fn(),
    captureProjectRevision: vi.fn(),
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: vi.fn(),
    renderOffline: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelExport: mocks.cancelExport,
    renderOffline: mocks.renderOffline,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
    projectRevisionMatchesLiveIgnoringCommandCheckpoint: mocks.projectRevisionMatchesLiveIgnoringCommandCheckpoint,
}));

function createAudioBuffer(
    input: {
        sampleRate?: number;
        length?: number;
        numberOfChannels?: number;
    } = {}
) {
    const sampleRate = input.sampleRate ?? 44_100;
    const length = input.length ?? 88_200;
    const numberOfChannels = input.numberOfChannels ?? 2;
    return {
        sampleRate,
        length,
        numberOfChannels,
        duration: length / sampleRate,
    };
}

function createJob(overrides: Partial<RenderProjectSectionJobSnapshot> = {}): RenderProjectSectionJobSnapshot {
    return {
        jobId: 'render-chorus-one',
        sectionId: 'section-chorus-one',
        sectionName: 'Chorus One',
        startBeat: 16,
        endBeat: 48,
        sampleRate: 44_100,
        tailSeconds: 0,
        ...overrides,
    };
}

describe('renderAgentProjectSections', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAgentSectionRenderArtifacts();
        mocks.captureProjectRevision.mockReturnValue('revision-a');
        mocks.projectRevisionMatchesLiveIgnoringCommandCheckpoint.mockImplementation(
            (revision: string) => mocks.captureProjectRevision() === revision
        );
        mocks.renderOffline.mockResolvedValue(createAudioBuffer());
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders exact ranges into session-owned revision-bound artifacts', async () => {
        const job = createJob();
        const input = { jobs: [job], sourceRevision: 'revision-a' };

        await renderAgentProjectSections(input);

        expect(mocks.renderOffline).toHaveBeenCalledWith({
            durationBeats: 32,
            startBeat: 16,
            sampleRate: 44_100,
            tailSeconds: 0,
            onWarning: expect.any(Function),
        });
        expect(getAgentSectionRenderArtifacts()).toEqual([
            expect.objectContaining({
                owner: 'agent-section-render',
                retention: 'session',
                jobId: 'render-chorus-one',
                sectionId: 'section-chorus-one',
                sourceRevision: 'revision-a',
                durationSeconds: 2,
                frameCount: 88_200,
                channelCount: 2,
                byteSize: 705_600,
                warnings: [],
            }),
        ]);
    });

    it('reports only jobs whose offline renderer begins, excluding retained and preflight-refused work', async () => {
        const retainedJob = createJob();
        const missingJob = createJob({
            jobId: 'render-chorus-two',
            sectionId: 'section-chorus-two',
            sectionName: 'Chorus Two',
            startBeat: 64,
            endBeat: 96,
        });
        await renderAgentProjectSections({ jobs: [retainedJob], sourceRevision: 'revision-a' });
        const sequence: string[] = [];
        const onRenderAttempt = vi.fn((job: RenderProjectSectionJobSnapshot) => sequence.push(`attempt:${job.jobId}`));
        mocks.renderOffline.mockImplementationOnce(() => {
            sequence.push('render');
            return Promise.resolve(createAudioBuffer());
        });

        await renderAgentProjectSections({
            jobs: [retainedJob, missingJob],
            sourceRevision: 'revision-a',
            onRenderAttempt,
        });

        expect(onRenderAttempt).toHaveBeenCalledExactlyOnceWith(missingJob);
        expect(sequence).toEqual(['attempt:render-chorus-two', 'render']);

        mocks.captureProjectRevision.mockReturnValue('revision-b');
        await expect(
            renderAgentProjectSections({
                jobs: [createJob({ jobId: 'render-preflight-refused' })],
                sourceRevision: 'revision-a',
                onRenderAttempt,
            })
        ).rejects.toThrow('Project changed during rendering');
        expect(onRenderAttempt).toHaveBeenCalledTimes(1);
    });

    it('never mixes artifacts from different project revisions in one render batch', async () => {
        const jobs = [
            createJob(),
            createJob({
                jobId: 'render-chorus-two',
                sectionId: 'section-chorus-two',
                sectionName: 'Chorus Two',
                startBeat: 64,
                endBeat: 96,
            }),
        ];
        const input = { jobs, sourceRevision: 'revision-a' };
        mocks.captureProjectRevision
            .mockReturnValueOnce('revision-a')
            .mockReturnValueOnce('revision-a')
            .mockReturnValue('revision-b');

        await expect(renderAgentProjectSections(input)).rejects.toThrow('Project changed during rendering');

        expect(mocks.renderOffline).toHaveBeenCalledOnce();
        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.jobId)).toEqual(['render-chorus-one']);
    });

    it.each([
        ['a mismatched sample rate', createAudioBuffer({ sampleRate: 48_000 })],
        ['a non-positive channel count', createAudioBuffer({ numberOfChannels: 0 })],
    ])('rejects %s without attaching an artifact', async (_label, buffer) => {
        mocks.renderOffline.mockResolvedValueOnce(buffer);

        await expect(renderAgentProjectSections({ jobs: [createJob()], sourceRevision: 'revision-a' })).rejects.toThrow(
            'invalid section artifact'
        );

        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('cancels the active render and prevents later jobs or artifacts after its execution signal aborts', async () => {
        const controller = new AbortController();
        const jobs = [
            createJob(),
            createJob({
                jobId: 'render-chorus-two',
                sectionId: 'section-chorus-two',
                sectionName: 'Chorus Two',
                startBeat: 64,
                endBeat: 96,
            }),
        ];
        let finishActiveRender: ((buffer: ReturnType<typeof createAudioBuffer>) => void) | undefined;
        mocks.renderOffline.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishActiveRender = resolve;
                })
        );

        const rendering = renderAgentProjectSections({ jobs, sourceRevision: 'revision-a', signal: controller.signal });
        await vi.waitFor(() => expect(mocks.renderOffline).toHaveBeenCalledOnce());
        controller.abort();
        expect(mocks.cancelExport).toHaveBeenCalledOnce();
        finishActiveRender?.(createAudioBuffer());

        await expect(rendering).rejects.toThrow(/cancel/i);
        expect(mocks.renderOffline).toHaveBeenCalledOnce();
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('refuses attachment when its injected authority validator changes during an awaited render', async () => {
        let finishRender!: (buffer: ReturnType<typeof createAudioBuffer>) => void;
        let attachmentAllowed = true;
        mocks.renderOffline.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishRender = resolve;
                })
        );

        const rendering = renderAgentProjectSections({
            jobs: [createJob()],
            sourceRevision: 'revision-a',
            validateArtifactAttachment: () =>
                attachmentAllowed
                    ? null
                    : 'Only the authoritative collaboration host can attach section render artifacts.',
        });
        await vi.waitFor(() => expect(mocks.renderOffline).toHaveBeenCalledOnce());
        attachmentAllowed = false;
        finishRender(createAudioBuffer());

        await expect(rendering).rejects.toMatchObject({
            message: expect.stringContaining(
                'Only the authoritative collaboration host can attach section render artifacts.'
            ),
            pendingEffect: expect.objectContaining({ remediation: 'reconcile', state: 'pending' }),
        });
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('aborts before a second render when attachment authority is lost during the first render', async () => {
        const jobs = [
            createJob(),
            createJob({
                jobId: 'render-chorus-two',
                sectionId: 'section-chorus-two',
                sectionName: 'Chorus Two',
                startBeat: 64,
                endBeat: 96,
            }),
        ];
        let finishFirstRender!: (buffer: ReturnType<typeof createAudioBuffer>) => void;
        let attachmentAllowed = true;
        const onRenderAttempt = vi.fn();
        mocks.renderOffline.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishFirstRender = resolve;
                })
        );

        const rendering = renderAgentProjectSections({
            jobs,
            sourceRevision: 'revision-a',
            onRenderAttempt,
            validateArtifactAttachment: () =>
                attachmentAllowed
                    ? null
                    : 'Only the authoritative collaboration host can attach section render artifacts.',
        });
        await vi.waitFor(() => expect(mocks.renderOffline).toHaveBeenCalledOnce());
        attachmentAllowed = false;
        finishFirstRender(createAudioBuffer());

        await expect(rendering).rejects.toEqual(
            new Error('Only the authoritative collaboration host can attach section render artifacts.')
        );
        expect(mocks.renderOffline).toHaveBeenCalledOnce();
        expect(onRenderAttempt).toHaveBeenCalledExactlyOnceWith(jobs[0]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('does not begin rendering when attachment authority is denied at preflight', async () => {
        const onRenderAttempt = vi.fn();

        await expect(
            renderAgentProjectSections({
                jobs: [createJob()],
                sourceRevision: 'revision-a',
                onRenderAttempt,
                validateArtifactAttachment: () =>
                    'Only the authoritative collaboration host can attach section render artifacts.',
            })
        ).rejects.toThrow('Only the authoritative collaboration host');

        expect(onRenderAttempt).not.toHaveBeenCalled();
        expect(mocks.renderOffline).not.toHaveBeenCalled();
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('continues to later jobs after one renderer rejects and preserves the successful artifact', async () => {
        const jobs = [
            createJob(),
            createJob({ jobId: 'render-chorus-two', sectionId: 'section-chorus-two', sectionName: 'Chorus Two' }),
        ];
        const onRenderAttempt = vi.fn();
        mocks.renderOffline.mockRejectedValueOnce(new Error('first renderer unavailable'));

        await expect(
            renderAgentProjectSections({ jobs, sourceRevision: 'revision-a', onRenderAttempt })
        ).rejects.toThrow('first renderer unavailable');

        expect(onRenderAttempt).toHaveBeenCalledTimes(2);
        expect(mocks.renderOffline).toHaveBeenCalledTimes(2);
        expect(getAgentSectionRenderArtifacts()).toEqual([expect.objectContaining({ jobId: 'render-chorus-two' })]);
    });

    it('keeps successful artifacts and retries only unfinished jobs after a transient failure', async () => {
        const jobs = [
            createJob(),
            createJob({
                jobId: 'render-chorus-two',
                sectionId: 'section-chorus-two',
                sectionName: 'Chorus Two',
                startBeat: 64,
                endBeat: 96,
            }),
        ];
        const input = { jobs, sourceRevision: 'revision-a' };
        mocks.renderOffline
            .mockResolvedValueOnce(createAudioBuffer())
            .mockRejectedValueOnce(new Error('renderer unavailable'))
            .mockResolvedValueOnce(createAudioBuffer());

        await expect(renderAgentProjectSections(input)).rejects.toThrow('renderer unavailable');
        await expect(renderAgentProjectSections(input)).resolves.toBeUndefined();

        expect(mocks.renderOffline).toHaveBeenCalledTimes(3);
        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.jobId)).toEqual([
            'render-chorus-one',
            'render-chorus-two',
        ]);
    });

    it('retains renderer warnings on the artifact and surfaces review-required failure', async () => {
        const input = { jobs: [createJob()], sourceRevision: 'revision-a' };
        mocks.renderOffline.mockImplementation((options: { onWarning?: (warning: string) => void }) => {
            options.onWarning?.('tail truncated');
            return Promise.resolve(createAudioBuffer());
        });

        await expect(renderAgentProjectSections(input)).rejects.toMatchObject({
            message: expect.stringContaining('tail truncated'),
            pendingEffect: {
                kind: 'external-effect',
                remediation: 'manual-repair',
                reason: expect.stringContaining('tail truncated'),
                state: 'pending',
            },
        });

        expect(getAgentSectionRenderArtifacts()[0]?.warnings).toEqual(['tail truncated']);
    });

    it('keeps missing render work reconcilable when another retained artifact has warnings', async () => {
        const jobs = [
            createJob(),
            createJob({
                jobId: 'render-missing-chorus',
                sectionId: 'section-missing-chorus',
                sectionName: 'Missing Chorus',
                startBeat: 64,
                endBeat: 96,
            }),
        ];
        mocks.renderOffline
            .mockImplementationOnce((options: { onWarning?: (warning: string) => void }) => {
                options.onWarning?.('tail truncated');
                return Promise.resolve(createAudioBuffer());
            })
            .mockRejectedValueOnce(new Error('renderer unavailable'));

        await expect(renderAgentProjectSections({ jobs, sourceRevision: 'revision-a' })).rejects.toMatchObject({
            pendingEffect: {
                kind: 'external-effect',
                remediation: 'reconcile',
                state: 'pending',
            },
        });
        expect(getAgentSectionRenderArtifacts()).toEqual([
            expect.objectContaining({ jobId: 'render-chorus-one', warnings: ['tail truncated'] }),
        ]);
    });

    it('rejects invalid buffers and job-capacity overflow without attaching artifacts', async () => {
        const input = { jobs: [createJob()], sourceRevision: 'revision-a' };
        mocks.renderOffline.mockResolvedValueOnce(createAudioBuffer({ length: 0 }));

        await expect(renderAgentProjectSections(input)).rejects.toThrow('invalid section artifact');
        expect(getAgentSectionRenderArtifacts()).toEqual([]);

        const jobs = Array.from({ length: 17 }, (_, index) =>
            createJob({
                jobId: `render-${String(index)}`,
                sectionId: `section-${String(index)}`,
                sectionName: `Section ${String(index)}`,
            })
        );
        await expect(renderAgentProjectSections({ jobs, sourceRevision: 'revision-a' })).rejects.toThrow(
            'artifact capacity exceeded: 17/16'
        );
        expect(mocks.renderOffline).toHaveBeenCalledOnce();
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('evicts the oldest completed artifacts when a later render reaches the session count bound', async () => {
        const jobs = Array.from({ length: 17 }, (_, index) =>
            createJob({
                jobId: `render-${String(index)}`,
                sectionId: `section-${String(index)}`,
                sectionName: `Section ${String(index)}`,
            })
        );

        for (const job of jobs) {
            await renderAgentProjectSections({ jobs: [job], sourceRevision: 'revision-a' });
        }

        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.jobId)).toEqual(
            jobs.slice(1).map((job) => job.jobId)
        );
        expect(mocks.renderOffline).toHaveBeenCalledTimes(17);
    });

    it('renders only the executable job while protecting retained approved artifacts from eviction', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-28T10:00:00Z'));
        const retainedJob = createJob({ jobId: 'render-retained' });
        await renderAgentProjectSections({ jobs: [retainedJob], sourceRevision: 'revision-a' });
        const fillerJobs = Array.from({ length: 15 }, (_, index) =>
            createJob({
                jobId: `render-filler-${String(index)}`,
                sectionId: `section-filler-${String(index)}`,
                sectionName: `Filler ${String(index)}`,
            })
        );
        for (const job of fillerJobs) {
            vi.advanceTimersByTime(1);
            await renderAgentProjectSections({ jobs: [job], sourceRevision: 'revision-a' });
        }
        const missingJob = createJob({
            jobId: 'render-missing',
            sectionId: 'section-missing',
            sectionName: 'Missing',
        });
        const onRenderAttempt = vi.fn();
        mocks.renderOffline.mockClear();

        await renderAgentProjectSections({
            jobs: [missingJob],
            retentionProtectedJobIds: [retainedJob.jobId, missingJob.jobId],
            sourceRevision: 'revision-a',
            onRenderAttempt,
        });

        expect(onRenderAttempt).toHaveBeenCalledExactlyOnceWith(missingJob);
        expect(mocks.renderOffline).toHaveBeenCalledOnce();
        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.jobId)).toContain(retainedJob.jobId);
    });

    it('expires old artifacts and rejects a buffer larger than the session byte bound', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-11T08:00:00Z'));
        await renderAgentProjectSections({ jobs: [createJob()], sourceRevision: 'revision-a' });

        vi.advanceTimersByTime(AGENT_SECTION_RENDER_RETENTION_POLICY.maxAgeMs + 1);
        const freshJob = createJob({
            jobId: 'render-chorus-two',
            sectionId: 'section-chorus-two',
            sectionName: 'Chorus Two',
        });
        await renderAgentProjectSections({ jobs: [freshJob], sourceRevision: 'revision-a' });

        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.jobId)).toEqual([freshJob.jobId]);

        clearAgentSectionRenderArtifacts();
        const oversizedFrameCount =
            Math.floor(AGENT_SECTION_RENDER_RETENTION_POLICY.maxPcmBytes / (2 * Float32Array.BYTES_PER_ELEMENT)) + 1;
        mocks.renderOffline.mockResolvedValueOnce(createAudioBuffer({ length: oversizedFrameCount }));

        await expect(renderAgentProjectSections({ jobs: [createJob()], sourceRevision: 'revision-a' })).rejects.toThrow(
            'artifact byte capacity exceeded'
        );
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('does not estimate a shifted tempo-map range from a same-span artifact', async () => {
        const frameCount = Math.floor(
            (AGENT_SECTION_RENDER_RETENTION_POLICY.maxPcmBytes * 3) / (4 * 2 * Float32Array.BYTES_PER_ELEMENT)
        );
        const retainedJob = createJob({ jobId: 'render-retained' });
        const shiftedJob = createJob({
            jobId: 'render-shifted',
            sectionId: 'section-shifted',
            sectionName: 'Shifted',
            startBeat: 64,
            endBeat: 96,
        });
        mocks.renderOffline.mockResolvedValue(createAudioBuffer({ length: frameCount }));
        await renderAgentProjectSections({ jobs: [retainedJob], sourceRevision: 'revision-a' });

        expect(wouldAgentSectionRenderSetExceedRetention([retainedJob, shiftedJob])).toBe(false);
    });

    it('preserves approved artifacts when a missing artifact cannot coexist within retention capacity', async () => {
        const frameCount = Math.floor(
            (AGENT_SECTION_RENDER_RETENTION_POLICY.maxPcmBytes * 3) / (4 * 2 * Float32Array.BYTES_PER_ELEMENT)
        );
        const firstJob = createJob({ jobId: 'render-chorus-one' });
        const missingJob = createJob({
            jobId: 'render-chorus-two',
            sectionId: 'section-chorus-two',
            sectionName: 'Chorus Two',
            startBeat: 64,
            endBeat: 96,
        });
        mocks.renderOffline.mockResolvedValue(createAudioBuffer({ length: frameCount }));

        await renderAgentProjectSections({ jobs: [firstJob], sourceRevision: 'revision-a' });

        await expect(
            renderAgentProjectSections({ jobs: [firstJob, missingJob], sourceRevision: 'revision-a' })
        ).rejects.toMatchObject({
            pendingEffect: {
                kind: 'external-effect',
                remediation: 'manual-repair',
                state: 'pending',
            },
        });

        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.jobId)).toEqual([firstJob.jobId]);
    });

    it('rejects a reused job identity whose render provenance differs', async () => {
        const job = createJob();

        await renderAgentProjectSections({ jobs: [job], sourceRevision: 'revision-a' });
        mocks.captureProjectRevision.mockReturnValue('revision-b');

        await expect(renderAgentProjectSections({ jobs: [job], sourceRevision: 'revision-b' })).rejects.toMatchObject({
            message: expect.stringContaining('bound to a different project revision'),
            pendingEffect: expect.objectContaining({ remediation: 'reconcile', state: 'pending' }),
        });
        expect(mocks.renderOffline).toHaveBeenCalledOnce();
        expect(getAgentSectionRenderArtifacts().map((artifact) => artifact.sourceRevision)).toEqual(['revision-a']);
    });

    it('attaches when live revision advanced only for the command-batch checkpoint', async () => {
        mocks.captureProjectRevision.mockReturnValue('revision-checkpoint');
        mocks.projectRevisionMatchesLiveIgnoringCommandCheckpoint.mockReturnValue(true);

        await renderAgentProjectSections({ jobs: [createJob()], sourceRevision: 'revision-a' });

        expect(getAgentSectionRenderArtifacts()).toEqual([
            expect.objectContaining({ jobId: 'render-chorus-one', sourceRevision: 'revision-a' }),
        ]);
    });

    it('replaces a stale same-job artifact when retry asks to rebind the job identity', async () => {
        const job = createJob();
        await renderAgentProjectSections({ jobs: [job], sourceRevision: 'revision-a' });
        mocks.captureProjectRevision.mockReturnValue('revision-b');
        mocks.projectRevisionMatchesLiveIgnoringCommandCheckpoint.mockImplementation(
            (revision: string) => revision === 'revision-b'
        );

        await renderAgentProjectSections({
            jobs: [job],
            sourceRevision: 'revision-b',
            replaceMismatchedRevisionArtifacts: true,
        });

        expect(mocks.renderOffline).toHaveBeenCalledTimes(2);
        expect(getAgentSectionRenderArtifacts()).toEqual([
            expect.objectContaining({ jobId: job.jobId, sourceRevision: 'revision-b' }),
        ]);
    });
});
