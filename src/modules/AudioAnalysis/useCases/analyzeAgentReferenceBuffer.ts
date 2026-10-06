import { getAgentMeasurementMetricIds } from './getAgentMeasurementMetricIds';
import { measureAgentScopeRender } from './measureAgentScopeRender';

/**
 * The agent measurement of a reference the user supplied: the buffer in, the full agent metric set
 * and the buffer's own shape out.
 *
 * It reads the same procedure a project render goes through, with every metric, so a reference and
 * a project target report the same figures and subtract. The result holds figures and a shape, never
 * a sample: the caller may drop the buffer the moment this returns.
 */

type AgentReferenceAnalysis = {
    readonly measurements: ReturnType<typeof measureAgentScopeRender>;
    readonly sampleRate: number;
    readonly frameCount: number;
    readonly channelCount: number;
    readonly durationSeconds: number;
};

export function analyzeAgentReferenceBuffer(buffer: AudioBuffer): AgentReferenceAnalysis {
    const { sampleRate, length } = buffer;
    return {
        measurements: measureAgentScopeRender(buffer, getAgentMeasurementMetricIds()),
        sampleRate,
        frameCount: length,
        channelCount: buffer.numberOfChannels,
        durationSeconds: sampleRate > 0 ? length / sampleRate : 0,
    };
}
