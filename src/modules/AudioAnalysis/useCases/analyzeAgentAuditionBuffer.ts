import {
    type AgentAuditionAnalysisReceipt,
    type AgentAuditionComparison,
    type AgentObjectiveMetricEntry,
    type AgentObjectiveMetricId,
} from '../models/AgentObjectiveAnalysisTypes';
import { compareAgentObjectiveMeasurements } from '../services/agentObjectiveAnalysis/compareAgentObjectiveMeasurements';

import { measureAgentObjectiveBuffer } from './measureAgentObjectiveBuffer';

/**
 * Objective analysis of one auditioned buffer.
 *
 * The audio is decoded audio a caller holds, not a retained project artifact, so
 * the receipt names it by content address and catalog candidate id. That is
 * enough for a later step to prove it applied the audio it measured, and it
 * claims nothing about a project revision the analysis never read.
 */

type AnalyzeAgentAuditionBufferInput = {
    readonly buffer: AudioBuffer;
    readonly subject: {
        readonly contentAddress: string;
        readonly candidateId: string;
    };
    readonly baseline?: AgentAuditionAnalysisReceipt;
    /** Supplied by callers that stamp their own clock; otherwise read here. */
    readonly analyzedAt?: string;
};

type ResolvedComparison = {
    readonly comparison: AgentAuditionComparison | null;
    readonly warnings: readonly string[];
};

function resolveComparison(
    measurements: Record<AgentObjectiveMetricId, AgentObjectiveMetricEntry>,
    baseline: AgentAuditionAnalysisReceipt | undefined
): ResolvedComparison {
    if (!baseline) {
        return { comparison: null, warnings: [] };
    }
    // A baseline is data from an earlier audition, possibly written by an older
    // or newer build, so its version is read as a number rather than trusted.
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
                candidateId: baseline.subject.candidateId,
            },
            metrics: compareAgentObjectiveMeasurements({ candidate: measurements, baseline: baseline.measurements }),
        },
        warnings: [],
    };
}

export function analyzeAgentAuditionBuffer({
    buffer,
    subject,
    baseline,
    analyzedAt,
}: AnalyzeAgentAuditionBufferInput): AgentAuditionAnalysisReceipt {
    const measured = measureAgentObjectiveBuffer(buffer);
    const { comparison, warnings } = resolveComparison(measured.measurements, baseline);

    return {
        status: 'measured',
        schemaVersion: 1,
        subject: {
            contentAddress: subject.contentAddress,
            candidateId: subject.candidateId,
            sampleRate: measured.sampleRate,
            frameCount: measured.frameCount,
            channelCount: measured.channelCount,
            durationSeconds: measured.durationSeconds,
        },
        analyzedAt: analyzedAt ?? new Date().toISOString(),
        measurements: measured.measurements,
        comparison,
        warnings,
    };
}
