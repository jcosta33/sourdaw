import {
    AGENT_RUN_MAX_TEXT_LENGTH,
    MAX_AUDIBLE_CLAIM_METRICS,
    type AgentRunMeasuredAudibleMetric,
    type AgentRunMeasuredFigure,
    type AgentRunPlanAudibleImpact,
} from '../models/AgentRun';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 && value.length <= AGENT_RUN_MAX_TEXT_LENGTH ? value : null;
}

function readFigure(value: unknown): AgentRunMeasuredFigure | null {
    if (!isRecord(value) || typeof value.value !== 'number' || !Number.isFinite(value.value)) {
        return null;
    }
    const unit = readText(value.unit);
    return unit === null ? null : { value: value.value, unit };
}

function readRange(value: unknown): AgentRunMeasuredAudibleMetric['range'] | null {
    if (!isRecord(value) || typeof value.startBeat !== 'number' || typeof value.endBeat !== 'number') {
        return null;
    }
    if (!Number.isFinite(value.startBeat) || !Number.isFinite(value.endBeat)) {
        return null;
    }
    if (value.sectionId === null) {
        return { startBeat: value.startBeat, endBeat: value.endBeat, sectionId: null };
    }
    const sectionId = readText(value.sectionId);
    return sectionId === null ? null : { startBeat: value.startBeat, endBeat: value.endBeat, sectionId };
}

function readMetric(value: unknown): AgentRunMeasuredAudibleMetric | null {
    if (!isRecord(value)) {
        return null;
    }
    const targetId = readText(value.targetId);
    const targetKind =
        value.targetKind === 'master' || value.targetKind === 'track' || value.targetKind === 'bus'
            ? value.targetKind
            : null;
    const metricId = readText(value.metricId);
    const range = readRange(value.range);
    const baseline = readFigure(value.baseline);
    const preview = readFigure(value.preview);
    const delta = readFigure(value.delta);
    if (
        targetId === null ||
        targetKind === null ||
        range === null ||
        metricId === null ||
        baseline === null ||
        preview === null ||
        delta === null
    ) {
        return null;
    }
    return { targetId, targetKind, range, metricId, baseline, preview, delta };
}

function readMetrics(value: unknown): AgentRunMeasuredAudibleMetric[] | null {
    if (!Array.isArray(value) || value.length > MAX_AUDIBLE_CLAIM_METRICS) {
        return null;
    }
    const metrics: AgentRunMeasuredAudibleMetric[] = [];
    for (const candidate of value) {
        const metric = readMetric(candidate);
        if (metric === null) {
            return null;
        }
        metrics.push(metric);
    }
    return metrics;
}

/** A plan claims nothing audible, or the measured figures of one batch; any other shape is malformed. */
export function readAgentRunAudibleImpact(value: Record<string, unknown>): AgentRunPlanAudibleImpact | null {
    if (value.status === 'not-claimed') {
        const reason = readText(value.reason);
        return reason === null ? null : { status: 'not-claimed', reason };
    }
    if (value.status !== 'measured') {
        return null;
    }
    const revision = readText(value.revision);
    const batchContentHash = readText(value.batchContentHash);
    const metrics = readMetrics(value.metrics);
    if (revision === null || batchContentHash === null || metrics === null) {
        return null;
    }
    return { status: 'measured', revision, batchContentHash, metrics };
}
