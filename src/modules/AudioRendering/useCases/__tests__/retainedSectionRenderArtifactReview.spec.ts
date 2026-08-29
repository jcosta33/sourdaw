import { afterEach, describe, expect, it, vi } from 'vitest';

import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { agentSectionRenderArtifactStore } from '../../stores/agentSectionRenderArtifactStore';
import { disposeExactAgentSectionRenderArtifact } from '../disposeExactAgentSectionRenderArtifact';
import { exportExactAgentSectionRenderArtifactAsWav } from '../exportExactAgentSectionRenderArtifactAsWav';
import { getExactAgentSectionRenderArtifact } from '../getExactAgentSectionRenderArtifact';

const encode = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
vi.mock('../audioBufferToWav', () => ({ audioBufferToWav: encode }));
vi.mock('#/modules/Project/useCases', () => ({ isNativeProjectRuntimeAvailable: () => false }));
vi.mock('../../repositories/audioExport/downloadAudioWav', () => ({ downloadAudioWav: download }));

const job: RenderProjectSectionJobSnapshot = {
    jobId: 'job-1',
    sectionId: 'section-1',
    sectionName: 'Verse',
    startBeat: 0,
    endBeat: 16,
    sampleRate: 48_000,
    tailSeconds: 1,
};
const artifact = {
    owner: 'agent-section-render' as const,
    retention: 'session' as const,
    ...job,
    sourceRevision: 'revision-1',
    renderedAt: Date.now(),
    durationSeconds: 1,
    frameCount: 48_000,
    channelCount: 1,
    byteSize: 192_000,
    warnings: ['tail warning'],
    buffer: {} as AudioBuffer,
};

describe('retained section render review artifacts', () => {
    afterEach(() => {
        agentSectionRenderArtifactStore.set({ artifacts: [] });
        vi.clearAllMocks();
    });

    it('looks up, exports, and disposes only the exact revision-bound job', async () => {
        agentSectionRenderArtifactStore.set({ artifacts: [artifact] });
        encode.mockResolvedValue(new ArrayBuffer(4));

        expect(getExactAgentSectionRenderArtifact({ job, sourceRevision: 'revision-1' })).toBe(artifact);
        await expect(exportExactAgentSectionRenderArtifactAsWav({ job, sourceRevision: 'revision-1' })).resolves.toBe(
            true
        );
        expect(encode).toHaveBeenCalledWith(artifact.buffer);
        expect(download).toHaveBeenCalledWith(new ArrayBuffer(4), 'Verse.wav');
        expect(disposeExactAgentSectionRenderArtifact({ job, sourceRevision: 'revision-1' })).toBe(true);
        expect(getExactAgentSectionRenderArtifact({ job, sourceRevision: 'revision-1' })).toBeNull();
    });

    it('never substitutes an artifact whose immutable job fields or revision differ', () => {
        agentSectionRenderArtifactStore.set({ artifacts: [artifact] });
        expect(
            getExactAgentSectionRenderArtifact({ job: { ...job, endBeat: 15 }, sourceRevision: 'revision-1' })
        ).toBeNull();
        expect(getExactAgentSectionRenderArtifact({ job, sourceRevision: 'revision-2' })).toBeNull();
        expect(
            disposeExactAgentSectionRenderArtifact({ job: { ...job, jobId: 'other' }, sourceRevision: 'revision-1' })
        ).toBe(false);
        expect(agentSectionRenderArtifactStore.value?.artifacts).toEqual([artifact]);
    });
});
