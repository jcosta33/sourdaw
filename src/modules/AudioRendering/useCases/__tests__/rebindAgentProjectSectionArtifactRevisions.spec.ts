import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { clearAgentSectionRenderArtifacts } from '../clearAgentSectionRenderArtifacts';
import { getAgentSectionRenderArtifacts } from '../getAgentSectionRenderArtifacts';
import { rebindAgentProjectSectionArtifactRevisions } from '../rebindAgentProjectSectionArtifactRevisions';
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

function createAudioBuffer() {
    const sampleRate = 44_100;
    const length = 88_200;
    const numberOfChannels = 2;
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

async function renderJobs(jobs: readonly RenderProjectSectionJobSnapshot[]): Promise<void> {
    await renderAgentProjectSections({ jobs, sourceRevision: 'revision-a' });
}

function bindingsFor(jobs: readonly RenderProjectSectionJobSnapshot[]) {
    const artifacts = getAgentSectionRenderArtifacts();
    return jobs.map((job) => {
        const artifact = artifacts.find((candidate) => candidate.jobId === job.jobId);
        if (!artifact) {
            throw new Error(`Expected a rendered artifact for ${job.jobId}`);
        }
        return { job, renderedAt: artifact.renderedAt, sourceRevision: artifact.sourceRevision };
    });
}

describe('rebindAgentProjectSectionArtifactRevisions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAgentSectionRenderArtifacts();
        mocks.captureProjectRevision.mockReturnValue('revision-a');
        mocks.renderOffline.mockResolvedValue(createAudioBuffer());
    });

    it('rebinds exact fresh artifacts to the committed revision', async () => {
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
        await renderJobs(jobs);

        rebindAgentProjectSectionArtifactRevisions({
            artifacts: bindingsFor(jobs),
            sourceRevision: 'revision-committed',
        });

        expect(
            getAgentSectionRenderArtifacts().map(({ jobId, sourceRevision }) => ({ jobId, sourceRevision }))
        ).toEqual([
            { jobId: 'render-chorus-one', sourceRevision: 'revision-committed' },
            { jobId: 'render-chorus-two', sourceRevision: 'revision-committed' },
        ]);
    });

    it('throws instead of partially rebinding when a bound artifact has vanished', async () => {
        const survivingJob = createJob();
        const vanishedJob = createJob({
            jobId: 'render-chorus-two',
            sectionId: 'section-chorus-two',
            sectionName: 'Chorus Two',
            startBeat: 64,
            endBeat: 96,
        });
        const jobs = [survivingJob, vanishedJob];
        await renderJobs(jobs);
        const bindings = bindingsFor(jobs);
        clearAgentSectionRenderArtifacts();
        await renderJobs([survivingJob]);

        expect(() =>
            rebindAgentProjectSectionArtifactRevisions({
                artifacts: bindings,
                sourceRevision: 'revision-committed',
            })
        ).toThrow('render-chorus-two');
        expect(
            getAgentSectionRenderArtifacts().map(({ jobId, sourceRevision }) => ({ jobId, sourceRevision }))
        ).toEqual([{ jobId: 'render-chorus-one', sourceRevision: 'revision-a' }]);
    });

    it('treats an empty binding list as a no-op', () => {
        expect(() =>
            rebindAgentProjectSectionArtifactRevisions({ artifacts: [], sourceRevision: 'revision-committed' })
        ).not.toThrow();
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });
});
