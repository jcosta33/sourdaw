import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { AGENT_SECTION_RENDER_RETENTION_POLICY } from '../../models/AgentSectionRenderRetentionPolicy';
import { clearAgentSectionRenderArtifacts } from '../clearAgentSectionRenderArtifacts';
import { getAgentSectionRenderArtifacts } from '../getAgentSectionRenderArtifacts';
import { renderAgentProjectSections } from '../renderAgentProjectSections';

const mocks = vi.hoisted(() => ({
    cancelExport: vi.fn(),
    captureProjectRevision: vi.fn(),
    renderOffline: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    cancelExport: mocks.cancelExport,
    renderOffline: mocks.renderOffline,
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
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

        await expect(renderAgentProjectSections(input)).rejects.toThrow('tail truncated');

        expect(getAgentSectionRenderArtifacts()[0]?.warnings).toEqual(['tail truncated']);
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

    it('rejects a reused job identity whose render provenance differs', async () => {
        const job = createJob();

        await renderAgentProjectSections({ jobs: [job], sourceRevision: 'revision-a' });
        mocks.captureProjectRevision.mockReturnValue('revision-b');

        await expect(renderAgentProjectSections({ jobs: [job], sourceRevision: 'revision-b' })).rejects.toThrow(
            'identity is already owned'
        );
        expect(mocks.renderOffline).toHaveBeenCalledOnce();
    });
});
