import { getExactAgentSectionRenderArtifact } from '#/modules/AudioRendering/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import {
    type AgentObjectiveAnalysisReceipt,
    type AgentObjectiveComparison,
    type AgentObjectiveMetricEntry,
    type AgentObjectiveMetricId,
    type MeasuredAgentObjectiveAnalysisReceipt,
} from '../models/AgentObjectiveAnalysisTypes';
import { buildAgentObjectiveMeasurements } from '../services/agentObjectiveAnalysis/buildAgentObjectiveMeasurements';
import { compareAgentObjectiveMeasurements } from '../services/agentObjectiveAnalysis/compareAgentObjectiveMeasurements';
import { readRenderChannels } from '../services/agentObjectiveAnalysis/readRenderChannels';
import { refineOnsetTimes } from '../services/agentObjectiveAnalysis/refineOnsetTimes';

import { detectOnsets } from './detectOnsets';
import { measureProgramAudio } from './referenceMixComparison/analyzeMix/measureProgramAudio';

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

/** Low enough that a steady passage still registers its accents, high enough to ignore noise. */
const ONSET_SENSITIVITY = 0.3;
/** 50 ms — sixteenths at 300 BPM, below which two attacks are one event. */
const ONSET_MIN_INTERVAL_SECONDS = 0.05;

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

/** Onset times read from the first channel, empty when the render has no channels. */
function readOnsetTimes(buffer: AudioBuffer, channel: Float32Array | undefined): number[] {
    if (!channel) {
        return [];
    }
    return refineOnsetTimes({
        channel,
        length: buffer.length,
        sampleRate: buffer.sampleRate,
        onsetTimesSec: detectOnsets(buffer, ONSET_SENSITIVITY, ONSET_MIN_INTERVAL_SECONDS).map(
            (onset) => onset.timeSec
        ),
    });
}

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

    const { buffer } = artifact;
    const channels = readRenderChannels(buffer);
    const { length, sampleRate } = buffer;
    // Every figure is read from the samples, so the duration the metrics use is
    // the one the samples describe; the receipt's subject reports the artifact's
    // own record of the render alongside it.
    const durationSeconds = sampleRate > 0 ? length / sampleRate : 0;
    const programAnalysis = channels.length > 0 ? measureProgramAudio([buffer]) : null;
    const onsetTimesSec = readOnsetTimes(buffer, channels[0]);

    const measurements = buildAgentObjectiveMeasurements({
        channels,
        length,
        sampleRate,
        durationSeconds,
        onsetTimesSec,
        dynamicRangeDb: programAnalysis?.dynamicRange ?? null,
        frequencyProfile: programAnalysis?.frequencyProfile ?? null,
    });
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
