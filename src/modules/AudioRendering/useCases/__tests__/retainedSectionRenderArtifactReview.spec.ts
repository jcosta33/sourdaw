import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { AGENT_SECTION_RENDER_RETENTION_POLICY } from '../../models/AgentSectionRenderRetentionPolicy';
import { agentSectionRenderArtifactStore } from '../../stores/agentSectionRenderArtifactStore';
import { disposeExactAgentSectionRenderArtifact } from '../disposeExactAgentSectionRenderArtifact';
import { exportExactAgentSectionRenderArtifactAsWav } from '../exportExactAgentSectionRenderArtifactAsWav';
import { getExactAgentSectionRenderArtifact } from '../getExactAgentSectionRenderArtifact';

const encode = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
const nativeRuntime = vi.hoisted(() => vi.fn());
const selectNativeFile = vi.hoisted(() => vi.fn());
const writeNativeFile = vi.hoisted(() => vi.fn());
vi.mock('../audioBufferToWav', () => ({ audioBufferToWav: encode }));
vi.mock('#/modules/Project/useCases', () => ({ isNativeProjectRuntimeAvailable: nativeRuntime }));
vi.mock('../../repositories/audioExport/downloadAudioWav', () => ({ downloadAudioWav: download }));
vi.mock('../audioExport/selectNativeAudioExportFile', () => ({ selectNativeAudioExportFile: selectNativeFile }));
vi.mock('../audioExport/writeNativeAudioMixdownFile', () => ({ writeNativeAudioMixdownFile: writeNativeFile }));

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

    beforeEach(() => {
        nativeRuntime.mockReturnValue(false);
        selectNativeFile.mockResolvedValue('/exports/Verse.wav');
        writeNativeFile.mockResolvedValue(undefined);
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
        expect(
            getExactAgentSectionRenderArtifact({ job: { ...job, tailSeconds: 2 }, sourceRevision: 'revision-1' })
        ).toBeNull();
        const wrongSection = { ...job, sectionId: 'section-2' };
        expect(getExactAgentSectionRenderArtifact({ job: wrongSection, sourceRevision: 'revision-1' })).toBeNull();
        expect(disposeExactAgentSectionRenderArtifact({ job: wrongSection, sourceRevision: 'revision-1' })).toBe(false);
        expect(getExactAgentSectionRenderArtifact({ job, sourceRevision: 'revision-2' })).toBeNull();
        expect(
            disposeExactAgentSectionRenderArtifact({ job: { ...job, jobId: 'other' }, sourceRevision: 'revision-1' })
        ).toBe(false);
        expect(agentSectionRenderArtifactStore.value?.artifacts).toEqual([artifact]);
    });

    it('fails closed for duplicate, expired, and evicted exact artifact evidence', () => {
        agentSectionRenderArtifactStore.set({ artifacts: [artifact, { ...artifact }] });
        expect(getExactAgentSectionRenderArtifact({ job, sourceRevision: 'revision-1' })).toBeNull();
        expect(disposeExactAgentSectionRenderArtifact({ job, sourceRevision: 'revision-1' })).toBe(false);
        expect(agentSectionRenderArtifactStore.value?.artifacts).toHaveLength(2);

        agentSectionRenderArtifactStore.set({
            artifacts: [
                {
                    ...artifact,
                    renderedAt: Date.now() - AGENT_SECTION_RENDER_RETENTION_POLICY.maxAgeMs - 1,
                },
            ],
        });
        expect(getExactAgentSectionRenderArtifact({ job, sourceRevision: 'revision-1' })).toBeNull();

        agentSectionRenderArtifactStore.set({ artifacts: [] });
        expect(getExactAgentSectionRenderArtifact({ job, sourceRevision: 'revision-1' })).toBeNull();
    });

    it('uses the native select-and-write route without triggering a browser download', async () => {
        agentSectionRenderArtifactStore.set({ artifacts: [artifact] });
        encode.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
        nativeRuntime.mockReturnValue(true);

        await expect(exportExactAgentSectionRenderArtifactAsWav({ job, sourceRevision: 'revision-1' })).resolves.toBe(
            true
        );

        expect(selectNativeFile).toHaveBeenCalledWith({ formats: ['wav'], suggestedName: 'Verse.wav' });
        expect(writeNativeFile).toHaveBeenCalledWith({
            bytes: new Uint8Array([1, 2, 3]),
            format: 'wav',
            selectedFilePath: '/exports/Verse.wav',
        });
        expect(download).not.toHaveBeenCalled();
    });

    it('does not write when the native export picker is cancelled', async () => {
        agentSectionRenderArtifactStore.set({ artifacts: [artifact] });
        encode.mockResolvedValue(new ArrayBuffer(4));
        nativeRuntime.mockReturnValue(true);
        selectNativeFile.mockResolvedValue(null);

        await expect(exportExactAgentSectionRenderArtifactAsWav({ job, sourceRevision: 'revision-1' })).resolves.toBe(
            false
        );

        expect(writeNativeFile).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();
    });
});
