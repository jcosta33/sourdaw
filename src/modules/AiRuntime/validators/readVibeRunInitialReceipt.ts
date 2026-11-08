import { digest } from '#/utils/canonicalDigest';

import { ANALYSIS_MEASURE_MAX_TARGETS } from '../models/AnalysisMeasureLimits';
import { APPLICATION_TOOL_RECEIPT_MAX_BYTES, type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { type MeasuredMetricEntry } from '../models/MeasuredPreview';
import { type VibeRunVerificationRange } from '../models/VibeRunPlan';

type VibeRunInitialReceipt = ApplicationToolReceipt & {
    readonly status: 'success';
    readonly revision: string;
    readonly origin: 'application-verification';
    readonly data: {
        readonly kind: 'analysis-measurement';
        readonly schemaVersion: 1;
        readonly scope:
            { readonly kind: 'master' } | { readonly kind: 'tracks' | 'buses'; readonly ids: readonly string[] };
        readonly sourceRevisionDigest: string;
        readonly range: VibeRunVerificationRange & {
            readonly measuredSeconds: number;
            readonly renderedSeconds: number;
        };
        readonly metrics: readonly string[];
        readonly targets: readonly {
            readonly targetId: string;
            readonly targetKind: 'master' | 'track' | 'bus';
            readonly route: 'mixdown' | 'isolated-subgraph';
            readonly liveAudibility: 'audible' | 'muted' | 'disabled' | 'solo-suppressed';
            readonly soloActive: boolean;
            readonly artifact: {
                readonly contentAddress: string;
                readonly sampleRate: number;
                readonly frameCount: number;
                readonly channelCount: number;
                readonly durationSeconds: number;
            };
            readonly measurements: Readonly<Partial<Record<string, MeasuredMetricEntry>>>;
        }[];
    };
};

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function texts(value: unknown): value is string[] {
    return (
        Array.isArray(value) &&
        value.every((entry) => typeof entry === 'string' && entry.length > 0) &&
        new Set(value).size === value.length
    );
}
function positive(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
function metric(value: unknown): boolean {
    if (!record(value)) {
        return false;
    }
    if (value.status === 'unavailable') {
        return typeof value.reason === 'string' && value.reason.length > 0;
    }
    if (
        value.status !== 'measured' ||
        value.metricVersion !== 1 ||
        typeof value.unit !== 'string' ||
        (value.confidence !== 'exact' && value.confidence !== 'estimated')
    ) {
        return false;
    }
    if (typeof value.value === 'number') {
        return Number.isFinite(value.value);
    }
    return (
        record(value.value) &&
        Object.values(value.value).every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    );
}
function artifact(value: unknown): boolean {
    if (!record(value)) {
        return false;
    }
    return (
        typeof value.contentAddress === 'string' &&
        value.contentAddress.length > 0 &&
        positive(value.sampleRate) &&
        positive(value.frameCount) &&
        Number.isSafeInteger(value.frameCount) &&
        positive(value.channelCount) &&
        Number.isSafeInteger(value.channelCount) &&
        positive(value.durationSeconds) &&
        value.durationSeconds === value.frameCount / value.sampleRate
    );
}
function target(value: unknown): boolean {
    return (
        record(value) &&
        typeof value.targetId === 'string' &&
        ['master', 'track', 'bus'].includes(String(value.targetKind)) &&
        ['mixdown', 'isolated-subgraph'].includes(String(value.route)) &&
        ['audible', 'muted', 'disabled', 'solo-suppressed'].includes(String(value.liveAudibility)) &&
        typeof value.soloActive === 'boolean' &&
        artifact(value.artifact) &&
        record(value.measurements) &&
        Object.values(value.measurements).every(metric)
    );
}
function measurementRange(value: unknown): boolean {
    return (
        record(value) &&
        typeof value.startBeat === 'number' &&
        Number.isFinite(value.startBeat) &&
        value.startBeat >= 0 &&
        positive(value.endBeat) &&
        value.endBeat > value.startBeat &&
        (value.sectionId === null || typeof value.sectionId === 'string') &&
        positive(value.measuredSeconds) &&
        positive(value.renderedSeconds)
    );
}
function scopeTargets(scope: unknown, targets: readonly unknown[]): boolean {
    if (!record(scope) || targets.length === 0 || targets.length > ANALYSIS_MEASURE_MAX_TARGETS) {
        return false;
    }
    const ids = targets.map((entry) => (record(entry) ? entry.targetId : null));
    if (new Set(ids).size !== ids.length) {
        return false;
    }
    if (scope.kind === 'master') {
        return ids.length === 1 && ids[0] === 'master';
    }
    if (
        (scope.kind !== 'tracks' && scope.kind !== 'buses') ||
        !texts(scope.ids) ||
        JSON.stringify(ids) !== JSON.stringify(scope.ids)
    ) {
        return false;
    }
    const targetKind = scope.kind === 'tracks' ? 'track' : 'bus';
    return targets.every((entry) => record(entry) && entry.targetKind === targetKind);
}
function measurementData(value: Record<string, unknown>): boolean {
    if (
        value.kind !== 'analysis-measurement' ||
        value.schemaVersion !== 1 ||
        typeof value.sourceRevisionDigest !== 'string' ||
        !texts(value.metrics) ||
        !Array.isArray(value.targets) ||
        !value.targets.every(target) ||
        !measurementRange(value.range) ||
        !scopeTargets(value.scope, value.targets)
    ) {
        return false;
    }
    const metrics = value.metrics;
    return value.targets.every(
        (target) =>
            record(target) &&
            record(target.measurements) &&
            Object.keys(target.measurements).every((metricId) => metrics.includes(metricId))
    );
}
function envelope(value: Record<string, unknown>): boolean {
    return (
        value.schema === 'sourdaw.application-tool-receipt' &&
        value.schemaVersion === 1 &&
        value.toolName === 'analysis.measure' &&
        value.turn === 0 &&
        value.status === 'success' &&
        value.origin === 'application-verification' &&
        typeof value.callId === 'string' &&
        value.callId.length > 0 &&
        typeof value.revision === 'string' &&
        value.revision.length > 0 &&
        typeof value.summary === 'string' &&
        Array.isArray(value.warnings) &&
        value.warnings.every((entry) => typeof entry === 'string') &&
        value.error === null
    );
}
function receipt(value: unknown): value is VibeRunInitialReceipt {
    return (
        record(value) &&
        envelope(value) &&
        record(value.data) &&
        measurementData(value.data) &&
        value.data.sourceRevisionDigest === digest(value.revision)
    );
}

/** Only a bounded successful project read is an initial witness; previews and budget substitutes are not. */
export function readVibeRunInitialReceipt(value: unknown): VibeRunInitialReceipt | null {
    if (
        new TextEncoder().encode(JSON.stringify(value)).byteLength > APPLICATION_TOOL_RECEIPT_MAX_BYTES ||
        !receipt(value)
    ) {
        return null;
    }
    return value;
}
