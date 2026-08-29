import { afterEach, describe, expect, it, vi } from 'vitest';

import { AGENT_SECTION_RENDER_RETENTION_POLICY } from '../../models/AgentSectionRenderRetentionPolicy';
import { agentSectionRenderArtifactStore } from '../../stores/agentSectionRenderArtifactStore';
import { clearAgentSectionRenderArtifacts } from '../clearAgentSectionRenderArtifacts';
import { scheduleAgentSectionRenderArtifactExpiry } from '../scheduleAgentSectionRenderArtifactExpiry';

describe('scheduleAgentSectionRenderArtifactExpiry', () => {
    afterEach(() => {
        clearAgentSectionRenderArtifacts();
        vi.useRealTimers();
    });

    it('releases expired backing buffers without a read or another render', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-28T20:00:00Z'));
        const artifact = {
            owner: 'agent-section-render' as const,
            retention: 'session' as const,
            jobId: 'render-expiring',
            sectionId: 'section-expiring',
            sectionName: 'Expiring',
            startBeat: 0,
            endBeat: 16,
            sampleRate: 44_100,
            tailSeconds: 0,
            sourceRevision: 'revision-expiring',
            renderedAt: Date.now(),
            durationSeconds: 4,
            frameCount: 176_400,
            channelCount: 2,
            byteSize: 1_411_200,
            warnings: [],
            buffer: {} as AudioBuffer,
        };
        agentSectionRenderArtifactStore.set({ artifacts: [artifact] });
        scheduleAgentSectionRenderArtifactExpiry();

        vi.advanceTimersByTime(AGENT_SECTION_RENDER_RETENTION_POLICY.maxAgeMs + 1);

        expect(agentSectionRenderArtifactStore.value?.artifacts).toEqual([]);
    });
});
