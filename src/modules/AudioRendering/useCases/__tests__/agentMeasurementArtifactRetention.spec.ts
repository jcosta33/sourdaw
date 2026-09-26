import { afterEach, describe, expect, it, vi } from 'vitest';

import { AGENT_MEASUREMENT_RETENTION_POLICY } from '../../models/AgentMeasurementRetentionPolicy';
import { agentMeasurementArtifactStore } from '../../stores/agentMeasurementArtifactStore';
import { clearAgentMeasurementArtifacts } from '../clearAgentMeasurementArtifacts';
import { pruneExpiredAgentMeasurementArtifacts } from '../pruneExpiredAgentMeasurementArtifacts';
import { retainAgentMeasurementArtifacts } from '../retainAgentMeasurementArtifacts';

const PCM_SAMPLE_BYTE_SIZE = Float32Array.BYTES_PER_ELEMENT;

function bufferOfBytes(byteSize: number, channels = 1): AudioBuffer {
    return {
        sampleRate: 48_000,
        length: Math.ceil(byteSize / channels / PCM_SAMPLE_BYTE_SIZE),
        numberOfChannels: channels,
        duration: 1,
    } as unknown as AudioBuffer;
}

function contentAddresses(): string[] {
    return (agentMeasurementArtifactStore.value?.artifacts ?? []).map((artifact) => artifact.contentAddress);
}

describe('agent measurement artifact retention', () => {
    afterEach(() => {
        clearAgentMeasurementArtifacts();
        vi.useRealTimers();
    });

    it('evicts the oldest artifact once the count limit is exceeded', () => {
        for (let index = 0; index <= AGENT_MEASUREMENT_RETENTION_POLICY.maxArtifacts; index += 1) {
            retainAgentMeasurementArtifacts({
                renders: [{ contentAddress: `addr-${String(index)}`, buffer: bufferOfBytes(1024) }],
                sourceRevision: 'rev-1',
                now: index,
            });
        }

        const addresses = contentAddresses();
        expect(addresses).toHaveLength(AGENT_MEASUREMENT_RETENTION_POLICY.maxArtifacts);
        expect(addresses).not.toContain('addr-0');
        expect(addresses).toContain(`addr-${String(AGENT_MEASUREMENT_RETENTION_POLICY.maxArtifacts)}`);
    });

    it('evicts the oldest artifact once the byte limit is exceeded, even under the count limit', () => {
        const chunk = Math.floor(AGENT_MEASUREMENT_RETENTION_POLICY.maxPcmBytes * 0.4);
        retainAgentMeasurementArtifacts({
            renders: [{ contentAddress: 'addr-a', buffer: bufferOfBytes(chunk) }],
            sourceRevision: 'rev-1',
            now: 1,
        });
        retainAgentMeasurementArtifacts({
            renders: [{ contentAddress: 'addr-b', buffer: bufferOfBytes(chunk) }],
            sourceRevision: 'rev-1',
            now: 2,
        });
        // Combined with a and b this exceeds the byte ceiling, so the oldest (a)
        // must go even though only two of sixteen count slots are in use.
        retainAgentMeasurementArtifacts({
            renders: [{ contentAddress: 'addr-c', buffer: bufferOfBytes(chunk) }],
            sourceRevision: 'rev-1',
            now: 3,
        });

        expect(contentAddresses()).toEqual(['addr-b', 'addr-c']);
    });

    it('skips a render that alone exceeds the byte limit rather than retaining it', () => {
        const oversized = retainAgentMeasurementArtifacts({
            renders: [
                { contentAddress: 'addr-fits', buffer: bufferOfBytes(1024) },
                {
                    contentAddress: 'addr-oversized',
                    buffer: bufferOfBytes(AGENT_MEASUREMENT_RETENTION_POLICY.maxPcmBytes + 1),
                },
            ],
            sourceRevision: 'rev-1',
            now: 1,
        });

        expect(oversized).toEqual(['addr-oversized']);
        expect(contentAddresses()).toEqual(['addr-fits']);
    });

    it('expires a retained artifact by itself once its age limit passes, with no read or new render', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-28T20:00:00Z'));
        const now = Date.now();
        retainAgentMeasurementArtifacts({
            renders: [{ contentAddress: 'addr-expiring', buffer: bufferOfBytes(1024) }],
            sourceRevision: 'rev-1',
            now,
        });

        vi.advanceTimersByTime(AGENT_MEASUREMENT_RETENTION_POLICY.maxAgeMs + 1);

        expect(agentMeasurementArtifactStore.value?.artifacts).toEqual([]);
    });

    it('prunes only the artifact that has actually aged out, keeping a fresher one', () => {
        const now = 1_000_000;
        agentMeasurementArtifactStore.set({
            artifacts: [
                {
                    owner: 'agent-measurement',
                    retention: 'session',
                    contentAddress: 'addr-old',
                    sourceRevision: 'rev-1',
                    renderedAt: now - AGENT_MEASUREMENT_RETENTION_POLICY.maxAgeMs - 1,
                    sampleRate: 48_000,
                    frameCount: 1,
                    channelCount: 1,
                    durationSeconds: 1,
                    byteSize: 4,
                    buffer: {} as AudioBuffer,
                },
                {
                    owner: 'agent-measurement',
                    retention: 'session',
                    contentAddress: 'addr-fresh',
                    sourceRevision: 'rev-1',
                    renderedAt: now - 1,
                    sampleRate: 48_000,
                    frameCount: 1,
                    channelCount: 1,
                    durationSeconds: 1,
                    byteSize: 4,
                    buffer: {} as AudioBuffer,
                },
            ],
        });

        pruneExpiredAgentMeasurementArtifacts(now);

        expect(contentAddresses()).toEqual(['addr-fresh']);
    });
});
