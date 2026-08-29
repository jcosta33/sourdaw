import { afterEach, describe, expect, it, vi } from 'vitest';

import { AGENT_SECTION_RENDER_RETENTION_POLICY } from '../../models/AgentSectionRenderRetentionPolicy';
import { agentSectionRenderArtifactStore } from '../../stores/agentSectionRenderArtifactStore';
import { getAgentSectionRenderArtifacts } from '../getAgentSectionRenderArtifacts';

describe('getAgentSectionRenderArtifacts', () => {
    afterEach(() => {
        vi.useRealTimers();
        agentSectionRenderArtifactStore.set({ artifacts: [] });
    });

    it('excludes expired artifacts without mutating the owned store during a read', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-28T20:00:00Z'));
        const expiredArtifact = {
            owner: 'agent-section-render' as const,
            retention: 'session' as const,
            jobId: 'render-expired',
            sectionId: 'section-expired',
            sectionName: 'Expired',
            startBeat: 0,
            endBeat: 16,
            sampleRate: 44_100,
            tailSeconds: 0,
            sourceRevision: 'revision-expired',
            renderedAt: Date.now() - AGENT_SECTION_RENDER_RETENTION_POLICY.maxAgeMs - 1,
            durationSeconds: 4,
            frameCount: 176_400,
            channelCount: 2,
            byteSize: 1_411_200,
            warnings: [],
            buffer: {} as AudioBuffer,
        };
        agentSectionRenderArtifactStore.set({ artifacts: [expiredArtifact] });

        expect(getAgentSectionRenderArtifacts()).toEqual([]);
        expect(agentSectionRenderArtifactStore.value?.artifacts).toEqual([expiredArtifact]);
    });
});
