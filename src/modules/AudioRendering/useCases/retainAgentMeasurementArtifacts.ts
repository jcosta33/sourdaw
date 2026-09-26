import { type AgentMeasurementArtifact } from '../models/AgentMeasurementArtifact';
import { AGENT_MEASUREMENT_RETENTION_POLICY } from '../models/AgentMeasurementRetentionPolicy';
import { agentMeasurementArtifactStore } from '../stores/agentMeasurementArtifactStore';

import { pruneExpiredAgentMeasurementArtifacts } from './pruneExpiredAgentMeasurementArtifacts';
import { scheduleAgentMeasurementArtifactExpiry } from './scheduleAgentMeasurementArtifactExpiry';

const PCM_SAMPLE_BYTE_SIZE = Float32Array.BYTES_PER_ELEMENT;

type MeasuredRender = {
    contentAddress: string;
    buffer: AudioBuffer;
};

type RetainAgentMeasurementArtifactsInput = {
    renders: readonly MeasuredRender[];
    sourceRevision: string;
    now?: number;
};

/** Evicts oldest first until the incoming artifact fits both the count and the byte limit. */
function withIncoming(
    artifacts: readonly AgentMeasurementArtifact[],
    incoming: AgentMeasurementArtifact
): AgentMeasurementArtifact[] {
    const retained = artifacts
        .filter((artifact) => artifact.contentAddress !== incoming.contentAddress)
        .sort((left, right) => left.renderedAt - right.renderedAt);
    let retainedBytes = retained.reduce((total, artifact) => total + artifact.byteSize, 0);
    while (
        retained.length > 0 &&
        (retained.length + 1 > AGENT_MEASUREMENT_RETENTION_POLICY.maxArtifacts ||
            retainedBytes + incoming.byteSize > AGENT_MEASUREMENT_RETENTION_POLICY.maxPcmBytes)
    ) {
        const evicted = retained.shift()!;
        retainedBytes -= evicted.byteSize;
    }
    return [...retained, incoming];
}

/**
 * Retains each measured render under its content address, so measuring the
 * same audio again replaces one artifact rather than adding a second. Returns
 * the content addresses of renders larger than the whole byte limit, which are
 * not retained.
 */
export function retainAgentMeasurementArtifacts({
    renders,
    sourceRevision,
    now = Date.now(),
}: RetainAgentMeasurementArtifactsInput): string[] {
    pruneExpiredAgentMeasurementArtifacts(now);
    let artifacts = agentMeasurementArtifactStore.value?.artifacts ?? [];
    const oversized: string[] = [];
    for (const { contentAddress, buffer } of renders) {
        const byteSize = buffer.length * buffer.numberOfChannels * PCM_SAMPLE_BYTE_SIZE;
        if (byteSize > AGENT_MEASUREMENT_RETENTION_POLICY.maxPcmBytes) {
            oversized.push(contentAddress);
            continue;
        }
        artifacts = withIncoming(artifacts, {
            owner: 'agent-measurement',
            retention: 'session',
            contentAddress,
            sourceRevision,
            renderedAt: now,
            sampleRate: buffer.sampleRate,
            frameCount: buffer.length,
            channelCount: buffer.numberOfChannels,
            durationSeconds: buffer.duration,
            byteSize,
            buffer,
        });
    }
    agentMeasurementArtifactStore.set({ artifacts });
    scheduleAgentMeasurementArtifactExpiry(now);
    return oversized;
}
