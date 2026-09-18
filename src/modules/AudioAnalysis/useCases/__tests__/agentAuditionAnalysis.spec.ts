import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AGENT_OBJECTIVE_METRIC_IDS,
    type AgentAuditionAnalysisReceipt,
    type AgentObjectiveMetricId,
} from '../../models/AgentObjectiveAnalysisTypes';
import { analyzeAgentAuditionBuffer } from '../analyzeAgentAuditionBuffer';
import { analyzeAgentRenderReceipt } from '../analyzeAgentRenderReceipt';

const mocks = vi.hoisted(() => ({ getExactAgentSectionRenderArtifact: vi.fn() }));

vi.mock('#/modules/AudioRendering/useCases', () => ({
    getExactAgentSectionRenderArtifact: mocks.getExactAgentSectionRenderArtifact,
}));

const SAMPLE_RATE = 48_000;
const TONE_HZ = 1000;
const TONE_FRAMES = SAMPLE_RATE * 2;
const ANALYZED_AT = '2026-01-02T03:04:05.000Z';
const RENDER_CONTENT_ADDRESS = 'render-content-address';
const RENDER_SOURCE_REVISION = 'revision-9';

const JOB = {
    jobId: 'job-1',
    sectionId: 'section-1',
    sectionName: 'Chorus',
    startBeat: 0,
    endBeat: 16,
    sampleRate: SAMPLE_RATE,
    tailSeconds: 0.5,
};

/** A 1 kHz sine at the requested dBFS peak, the level BS.1770 reads back as its own figure. */
function sineChannel(peakDbfs: number, length: number): Float32Array {
    const amplitude = 10 ** (peakDbfs / 20);
    const samples = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        samples[index] = amplitude * Math.sin((2 * Math.PI * TONE_HZ * index) / SAMPLE_RATE);
    }
    return samples;
}

function audioBuffer(channelData: readonly Float32Array[]): AudioBuffer {
    const length = channelData[0]?.length ?? 0;
    return {
        sampleRate: SAMPLE_RATE,
        length,
        numberOfChannels: channelData.length,
        duration: length / SAMPLE_RATE,
        getChannelData: (channel: number) => channelData[channel] ?? new Float32Array(length),
    } as unknown as AudioBuffer;
}

function audition(
    channelData: readonly Float32Array[],
    options: {
        contentAddress?: string;
        candidateId?: string;
        baseline?: AgentAuditionAnalysisReceipt;
    } = {}
): AgentAuditionAnalysisReceipt {
    return analyzeAgentAuditionBuffer({
        buffer: audioBuffer(channelData),
        subject: {
            contentAddress: options.contentAddress ?? 'audition-content-address',
            candidateId: options.candidateId ?? 'sample-candidate',
        },
        baseline: options.baseline,
        analyzedAt: ANALYZED_AT,
    });
}

function scalar(receipt: AgentAuditionAnalysisReceipt, id: AgentObjectiveMetricId): number {
    const found = receipt.measurements[id];
    if (found.status !== 'measured') {
        throw new Error(`Expected ${id} to be measured, got unavailable (${found.reason})`);
    }
    if (typeof found.value !== 'number') {
        throw new TypeError(`Expected ${id} to be a scalar`);
    }
    return found.value;
}

describe('analyzeAgentAuditionBuffer', () => {
    beforeEach(() => {
        mocks.getExactAgentSectionRenderArtifact.mockReset();
    });

    it('names the audio it read and reports the metric set in full', () => {
        const tone = sineChannel(-6, TONE_FRAMES);

        const receipt = audition([tone, tone], {
            contentAddress: 'content-address-of-the-audition',
            candidateId: 'kick-01',
        });

        expect(receipt.status).toBe('measured');
        expect(receipt.schemaVersion).toBe(1);
        expect(receipt.analyzedAt).toBe(ANALYZED_AT);
        expect(receipt.subject).toEqual({
            contentAddress: 'content-address-of-the-audition',
            candidateId: 'kick-01',
            sampleRate: SAMPLE_RATE,
            frameCount: TONE_FRAMES,
            channelCount: 2,
            durationSeconds: TONE_FRAMES / SAMPLE_RATE,
        });
        // A 0.5012 peak sine quantises a hair below its own amplitude.
        expect(scalar(receipt, 'samplePeak')).toBeCloseTo(-6.02, 1);
        expect(Object.keys(receipt.measurements)).toEqual([...AGENT_OBJECTIVE_METRIC_IDS]);
        expect(receipt.comparison).toBeNull();
        expect(receipt.warnings).toEqual([]);
    });

    it('links a louder audition to the earlier candidate it is compared against', () => {
        const quiet = sineChannel(-23, TONE_FRAMES);
        const loud = sineChannel(-20, TONE_FRAMES);
        const baseline = audition([quiet, quiet], {
            contentAddress: 'content-address-of-the-baseline',
            candidateId: 'snare-quiet',
        });

        const candidate = audition([loud, loud], { candidateId: 'snare-loud', baseline });

        const comparison = candidate.comparison;
        if (!comparison) {
            throw new Error('Expected a comparison against the baseline receipt');
        }
        expect(comparison.baseline).toEqual({
            contentAddress: 'content-address-of-the-baseline',
            candidateId: 'snare-quiet',
        });
        expect(comparison.metrics.samplePeak).toEqual({
            status: 'compared',
            delta: expect.closeTo(3, 2),
            unit: 'dB',
        });
    });

    it('refuses to compare a baseline written against another schema version', () => {
        const tone = sineChannel(-23, TONE_FRAMES);
        const baseline = audition([tone, tone], { candidateId: 'hat-01' });
        const futureBaseline = { ...baseline, schemaVersion: 2 } as unknown as AgentAuditionAnalysisReceipt;

        const receipt = audition([tone, tone], { baseline: futureBaseline });

        expect(receipt.comparison).toBeNull();
        expect(receipt.warnings).toEqual(['Baseline receipt schema version 2 cannot be compared against version 1.']);
    });

    it('measures the same audio identically whether it is auditioned or read from a render', () => {
        const tone = sineChannel(-14, TONE_FRAMES);
        const buffer = audioBuffer([tone, tone]);
        mocks.getExactAgentSectionRenderArtifact.mockReturnValue({
            ...JOB,
            sourceRevision: RENDER_SOURCE_REVISION,
            owner: 'agent-section-render',
            retention: 'session',
            renderedAt: 1_700_000_000_000,
            durationSeconds: TONE_FRAMES / SAMPLE_RATE,
            frameCount: TONE_FRAMES,
            channelCount: 2,
            byteSize: TONE_FRAMES * 2 * 4,
            contentAddress: RENDER_CONTENT_ADDRESS,
            warnings: [],
            buffer,
        });

        const render = analyzeAgentRenderReceipt({
            subject: { job: JOB, sourceRevision: RENDER_SOURCE_REVISION, contentAddress: RENDER_CONTENT_ADDRESS },
        });
        const auditioned = audition([tone, tone]);

        if (render.status !== 'measured') {
            throw new Error(`Expected a measured render receipt, got unavailable (${render.reason})`);
        }
        expect(render.measurements).toEqual(auditioned.measurements);
    });
});
