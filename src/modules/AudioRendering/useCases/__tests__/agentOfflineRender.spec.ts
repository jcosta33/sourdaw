import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioBufferContentAddress, type AgentRenderReceipt } from '#/utils/agentRenderReceipt';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { clearAgentSectionRenderArtifacts } from '../clearAgentSectionRenderArtifacts';
import { getAgentSectionRenderArtifacts } from '../getAgentSectionRenderArtifacts';
import { renderAgentProjectSections } from '../renderAgentProjectSections';

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

function createAudioBuffer(input: { sampleRate?: number; samples?: readonly number[] } = {}) {
    const sampleRate = input.sampleRate ?? 44_100;
    const samples = input.samples ?? [0.25, -0.5, 0.75, 1];
    const channels = [Float32Array.from(samples), Float32Array.from(samples)];
    return {
        sampleRate,
        length: samples.length,
        numberOfChannels: channels.length,
        duration: samples.length / sampleRate,
        getChannelData: (channel: number) => channels[channel],
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

const secondJob = createJob({
    jobId: 'render-chorus-two',
    sectionId: 'section-chorus-two',
    sectionName: 'Chorus Two',
    startBeat: 64,
    endBeat: 96,
});

/** Mutable so a case can prove a later caller edit cannot reach an already recorded receipt. */
type CallerOwner = { runId: string; workId: string; leaseId: string; cancellationGeneration: number };

function createOwner(overrides: Partial<CallerOwner> = {}): CallerOwner {
    return { runId: 'run-1', workId: 'work-1', leaseId: 'lease-1', cancellationGeneration: 2, ...overrides };
}

function collectReceipts(): { receipts: AgentRenderReceipt[]; onReceipt: (receipt: AgentRenderReceipt) => void } {
    const receipts: AgentRenderReceipt[] = [];
    return { receipts, onReceipt: (receipt) => receipts.push(receipt) };
}

function phasesOf(receipts: readonly AgentRenderReceipt[]): string[] {
    return receipts.map((receipt) => receipt.phase);
}

describe('agent offline render receipts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearAgentSectionRenderArtifacts();
        mocks.captureProjectRevision.mockReturnValue('revision-a');
        mocks.projectRevisionMatchesLiveIgnoringCommandCheckpoint.mockImplementation(
            (revision: string) => mocks.captureProjectRevision() === revision
        );
        mocks.renderOffline.mockImplementation(() => Promise.resolve(createAudioBuffer()));
    });

    it('echoes an owner-local copy of the caller identity that later caller mutation cannot rewrite', async () => {
        const owner = createOwner();
        const { receipts, onReceipt } = collectReceipts();

        await renderAgentProjectSections({
            jobs: [createJob(), secondJob],
            sourceRevision: 'revision-a',
            owner,
            onReceipt,
        });

        expect(receipts.length).toBeGreaterThan(0);
        for (const receipt of receipts) {
            expect(receipt.owner).toEqual(createOwner());
            expect(receipt.owner).not.toBe(owner);
        }

        owner.leaseId = 'lease-superseded';
        owner.cancellationGeneration = 9;

        for (const receipt of receipts) {
            expect(receipt.owner).toEqual(createOwner());
        }
    });

    it('settles a two-job batch as started, rendered, started, rendered, completed with each job provenance', async () => {
        const firstJob = createJob();
        const { receipts, onReceipt } = collectReceipts();

        await renderAgentProjectSections({
            jobs: [firstJob, secondJob],
            sourceRevision: 'revision-a',
            owner: createOwner(),
            onReceipt,
        });

        expect(phasesOf(receipts)).toEqual(['started', 'rendered', 'started', 'rendered', 'batch-settled']);
        for (const [index, job] of [firstJob, firstJob, secondJob, secondJob].entries()) {
            const receipt = receipts[index];
            expect(receipt && 'provenance' in receipt ? receipt.provenance : null).toEqual({
                jobId: job.jobId,
                sectionId: job.sectionId,
                sectionName: job.sectionName,
                startBeat: job.startBeat,
                endBeat: job.endBeat,
                sampleRate: job.sampleRate,
                tailSeconds: job.tailSeconds,
                sourceRevision: 'revision-a',
            });
        }
        expect(receipts.at(-1)).toEqual({
            phase: 'batch-settled',
            owner: createOwner(),
            outcome: 'completed',
            jobIds: ['render-chorus-one', 'render-chorus-two'],
        });
    });

    it('content-addresses rendered audio identically for equal buffers and differently for one changed sample', async () => {
        const { receipts, onReceipt } = collectReceipts();

        await renderAgentProjectSections({
            jobs: [createJob(), secondJob],
            sourceRevision: 'revision-a',
            onReceipt,
        });

        const rendered = receipts.filter((receipt) => receipt.phase === 'rendered');
        expect(rendered).toHaveLength(2);
        const artifacts = getAgentSectionRenderArtifacts();
        for (const receipt of rendered) {
            const artifact = artifacts.find((candidate) => candidate.jobId === receipt.provenance.jobId);
            if (!artifact) {
                throw new Error(`Expected a stored artifact for ${receipt.provenance.jobId}`);
            }
            expect(artifact.contentAddress).toBe(receipt.contentAddress);
            expect(await getAudioBufferContentAddress(artifact.buffer)).toBe(receipt.contentAddress);
        }
        expect(rendered[0]?.contentAddress).toBe(rendered[1]?.contentAddress);

        clearAgentSectionRenderArtifacts();
        mocks.renderOffline.mockImplementation(() =>
            Promise.resolve(createAudioBuffer({ samples: [0.25, -0.5, 0.75, 0.5] }))
        );
        const alteredCollector = collectReceipts();

        await renderAgentProjectSections({
            jobs: [createJob()],
            sourceRevision: 'revision-a',
            onReceipt: alteredCollector.onReceipt,
        });

        const alteredRendered = alteredCollector.receipts.find((receipt) => receipt.phase === 'rendered');
        expect(alteredRendered?.contentAddress).not.toBe(rendered[0]?.contentAddress);
    });

    it('refuses a denied attachment with a receipt only, leaving no artifact for that job', async () => {
        const { receipts, onReceipt } = collectReceipts();

        await expect(
            renderAgentProjectSections({
                jobs: [createJob()],
                sourceRevision: 'revision-a',
                owner: createOwner(),
                onReceipt,
                validateArtifactAttachment: () => 'The publication queue is unavailable.',
            })
        ).rejects.toThrow('The publication queue is unavailable.');

        expect(phasesOf(receipts)).toEqual(['failed', 'batch-settled']);
        expect(receipts[0]).toEqual({
            phase: 'failed',
            owner: createOwner(),
            provenance: expect.objectContaining({ jobId: 'render-chorus-one' }),
            failureKind: 'attachment-refused',
        });
        expect(receipts[1]).toEqual(expect.objectContaining({ phase: 'batch-settled', outcome: 'failed' }));
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('cancels an in-flight job with a receipt only, leaving no artifact for that job', async () => {
        const controller = new AbortController();
        mocks.renderOffline.mockImplementation(() => {
            controller.abort();
            return Promise.resolve(createAudioBuffer());
        });
        const { receipts, onReceipt } = collectReceipts();

        await expect(
            renderAgentProjectSections({
                jobs: [createJob()],
                sourceRevision: 'revision-a',
                signal: controller.signal,
                owner: createOwner(),
                onReceipt,
            })
        ).rejects.toThrow('Agent section rendering was cancelled');

        expect(phasesOf(receipts)).toEqual(['started', 'cancelled', 'batch-settled']);
        expect(receipts[1]).toEqual({
            phase: 'cancelled',
            owner: createOwner(),
            provenance: expect.objectContaining({ jobId: 'render-chorus-one' }),
        });
        expect(receipts[2]).toEqual(expect.objectContaining({ phase: 'batch-settled', outcome: 'cancelled' }));
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('reports a live revision that moved away from the render as a revision mismatch', async () => {
        mocks.captureProjectRevision.mockReturnValue('revision-b');
        const { receipts, onReceipt } = collectReceipts();

        await expect(
            renderAgentProjectSections({ jobs: [createJob()], sourceRevision: 'revision-a', onReceipt })
        ).rejects.toThrow('Section render follow-up requires review');

        expect(receipts[0]).toEqual(
            expect.objectContaining({ phase: 'failed', failureKind: 'revision-mismatch', owner: null })
        );
        expect(receipts.at(-1)).toEqual(expect.objectContaining({ phase: 'batch-settled', outcome: 'failed' }));
    });

    it('fails a job whose live revision moved while the render was still pending, attaching nothing', async () => {
        let resolveRender!: (buffer: ReturnType<typeof createAudioBuffer>) => void;
        mocks.renderOffline.mockImplementation(
            () =>
                new Promise<ReturnType<typeof createAudioBuffer>>((resolve) => {
                    resolveRender = resolve;
                })
        );
        const { receipts, onReceipt } = collectReceipts();

        const render = renderAgentProjectSections({
            jobs: [createJob()],
            sourceRevision: 'revision-a',
            owner: createOwner(),
            onReceipt,
        });
        await vi.waitFor(() => expect(mocks.renderOffline).toHaveBeenCalledOnce());
        mocks.captureProjectRevision.mockReturnValue('revision-b');
        resolveRender(createAudioBuffer());

        await expect(render).rejects.toThrow('Section render follow-up requires review');
        expect(phasesOf(receipts)).toEqual(['started', 'failed', 'batch-settled']);
        expect(receipts[1]).toEqual({
            phase: 'failed',
            owner: createOwner(),
            provenance: expect.objectContaining({ jobId: 'render-chorus-one' }),
            failureKind: 'revision-mismatch',
        });
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('fails a buffer whose sample rate contradicts its job as an invalid buffer, attaching nothing', async () => {
        mocks.renderOffline.mockImplementation(() => Promise.resolve(createAudioBuffer({ sampleRate: 48_000 })));
        const { receipts, onReceipt } = collectReceipts();

        await expect(
            renderAgentProjectSections({ jobs: [createJob()], sourceRevision: 'revision-a', onReceipt })
        ).rejects.toThrow('Section render follow-up requires review');

        expect(phasesOf(receipts)).toEqual(['started', 'failed', 'batch-settled']);
        expect(receipts.filter((receipt) => receipt.phase === 'failed')).toEqual([
            expect.objectContaining({ phase: 'failed', failureKind: 'invalid-buffer' }),
        ]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('fails a rejecting offline render as a render error, attaching nothing', async () => {
        mocks.renderOffline.mockImplementation(() => Promise.reject(new Error('The offline renderer crashed.')));
        const { receipts, onReceipt } = collectReceipts();

        await expect(
            renderAgentProjectSections({ jobs: [createJob()], sourceRevision: 'revision-a', onReceipt })
        ).rejects.toThrow('Section render follow-up requires review');

        expect(phasesOf(receipts)).toEqual(['started', 'failed', 'batch-settled']);
        expect(receipts.filter((receipt) => receipt.phase === 'failed')).toEqual([
            expect.objectContaining({ phase: 'failed', failureKind: 'render-error' }),
        ]);
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('reports a job as started while its render is still pending', async () => {
        let resolveRender!: (buffer: ReturnType<typeof createAudioBuffer>) => void;
        mocks.renderOffline.mockImplementation(
            () =>
                new Promise<ReturnType<typeof createAudioBuffer>>((resolve) => {
                    resolveRender = resolve;
                })
        );
        const { receipts, onReceipt } = collectReceipts();

        const render = renderAgentProjectSections({
            jobs: [createJob()],
            sourceRevision: 'revision-a',
            onReceipt,
        });
        await vi.waitFor(() => expect(phasesOf(receipts)).toEqual(['started']));
        resolveRender(createAudioBuffer());

        await render;
        expect(phasesOf(receipts)).toEqual(['started', 'rendered', 'batch-settled']);
    });

    it('refuses an attachment that is withdrawn while the content address reads the rendered buffer', async () => {
        const rendered = createAudioBuffer();
        let attachmentRefusal: string | null = null;
        mocks.renderOffline.mockImplementation(() =>
            Promise.resolve({
                ...rendered,
                getChannelData: (channel: number) => {
                    attachmentRefusal = 'The publication queue closed during the render.';
                    return rendered.getChannelData(channel);
                },
            })
        );
        const { receipts, onReceipt } = collectReceipts();

        await expect(
            renderAgentProjectSections({
                jobs: [createJob()],
                sourceRevision: 'revision-a',
                onReceipt,
                validateArtifactAttachment: () => attachmentRefusal,
            })
        ).rejects.toThrow('Section render follow-up requires review');

        expect(phasesOf(receipts)).toEqual(['started', 'failed', 'batch-settled']);
        expect(receipts[1]).toEqual(expect.objectContaining({ phase: 'failed', failureKind: 'attachment-refused' }));
        expect(getAgentSectionRenderArtifacts()).toEqual([]);
    });

    it('records a null owner on every receipt when the caller supplies no work identity', async () => {
        const { receipts, onReceipt } = collectReceipts();

        await renderAgentProjectSections({ jobs: [createJob(), secondJob], sourceRevision: 'revision-a', onReceipt });

        expect(receipts.length).toBeGreaterThan(0);
        for (const receipt of receipts) {
            expect(receipt.owner).toBeNull();
        }
    });
});
