import { getExactAgentSectionRenderArtifact } from '#/modules/AudioRendering/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import {
    type AgentObjectiveAnalysisReceipt,
    type AgentObjectiveComparison,
    type AgentObjectiveMetricEntry,
    type AgentObjectiveMetricId,
    type MeasuredAgentObjectiveAnalysisReceipt,
} from '../models/AgentObjectiveAnalysisTypes';
import { compareAgentObjectiveMeasurements } from '../services/agentObjectiveAnalysis/compareAgentObjectiveMeasurements';

import { measureAgentObjectiveBuffer } from './measureAgentObjectiveBuffer';

/**
 * Objective analysis of one retained section render.
 *
 * An agent that changes a mix and then says it sounds better has said nothing a
 * later session can check. This reads the render the agent actually produced and
 * returns figures with the render's own identity attached: the content address
 * of the audio and the document revision it came from. A receipt whose subject
 * no longer matches the project is therefore recognisably stale rather than
 * quietly wrong, and a receipt that could not measure something says so in the
 * metric's own entry instead of filling the gap with an estimate.
 */

type AnalyzeAgentRenderReceiptInput = {
    readonly subject: {
        readonly job: RenderProjectSectionJobSnapshot;
        readonly sourceRevision: string;
        readonly contentAddress: string;
    };
    readonly baseline?: MeasuredAgentObjectiveAnalysisReceipt;
};

type ResolvedComparison = {
    readonly comparison: AgentObjectiveComparison | null;
    readonly warnings: readonly string[];
};

function resolveComparison(
    measurements: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>,
    baseline: MeasuredAgentObjectiveAnalysisReceipt | undefined
): ResolvedComparison {
    if (!baseline) {
        return { comparison: null, warnings: [] };
    }
    // A baseline is data from an earlier run, possibly written by an older or
    // newer build, so its version is read as a number rather than trusted.
    const baselineSchemaVersion: number = baseline.schemaVersion;
    if (baselineSchemaVersion !== 1) {
        return {
            comparison: null,
            warnings: [
                `Baseline receipt schema version ${baselineSchemaVersion} cannot be compared against version 1.`,
            ],
        };
    }
    return {
        comparison: {
            baseline: {
                contentAddress: baseline.subject.contentAddress,
                sourceRevision: baseline.subject.sourceRevision,
            },
            metrics: compareAgentObjectiveMeasurements({ candidate: measurements, baseline: baseline.measurements }),
        },
        warnings: [],
    };
}

export function analyzeAgentRenderReceipt({
    subject,
    baseline,
}: AnalyzeAgentRenderReceiptInput): AgentObjectiveAnalysisReceipt {
    const artifact = getExactAgentSectionRenderArtifact({
        job: subject.job,
        sourceRevision: subject.sourceRevision,
    });
    if (!artifact) {
        return { status: 'unavailable', reason: 'no-retained-artifact' };
    }
    if (artifact.contentAddress !== subject.contentAddress) {
        return { status: 'unavailable', reason: 'content-address-mismatch' };
    }

    // The metrics are read from the samples; the receipt's subject reports the
    // artifact's own record of the render alongside them.
    const { measurements } = measureAgentObjectiveBuffer(artifact.buffer);
    const { comparison, warnings } = resolveComparison(measurements, baseline);

    return {
        status: 'measured',
        schemaVersion: 1,
        subject: {
            contentAddress: artifact.contentAddress,
            sourceRevision: artifact.sourceRevision,
            jobId: artifact.jobId,
            sectionId: artifact.sectionId,
            sectionName: artifact.sectionName,
            startBeat: artifact.startBeat,
            endBeat: artifact.endBeat,
            sampleRate: artifact.sampleRate,
            frameCount: artifact.frameCount,
            channelCount: artifact.channelCount,
            durationSeconds: artifact.durationSeconds,
        },
        analyzedAt: new Date().toISOString(),
        measurements,
        comparison,
        warnings,
    };
}
