import type { AudioEngineDeviceReadinessDiagnostics } from '../models/AudioEngineState';

export type DeviceReadinessToken = {
    readonly deviceId: string;
    readonly tokenId: number;
};

export type DeviceContentLoadOutcome = 'ready' | 'failed' | 'cancelled';
export type DeviceReadinessFailureStage = 'node' | 'graph' | 'content' | 'runtime';

type DeviceReadinessStatus = 'node-pending' | 'graph-pending' | 'content-pending' | 'ready' | 'failed';

type TimingAccumulator = {
    samples: number;
    totalMs: number;
    lastMs: number;
    maxMs: number;
};

type DeviceReadinessRecord = {
    token: DeviceReadinessToken;
    deviceType: string;
    requiresContent: boolean;
    requestedAtMs: number;
    nodeReadyAtMs: number | null;
    graphReadyAtMs: number | null;
    contentReadyAtMs: number | null;
    playableReadyAtMs: number | null;
    failedAtMs: number | null;
    status: DeviceReadinessStatus;
    failureStage: DeviceReadinessFailureStage | null;
};

const MAX_RETAINED_TERMINAL_RECORDS = 256;

function highResolutionEpochMs(): number {
    return performance.timeOrigin + performance.now();
}

function timestamp(atMs: number | undefined): number {
    if (atMs === undefined || !Number.isFinite(atMs) || atMs < 0 || atMs > Number.MAX_SAFE_INTEGER) {
        return highResolutionEpochMs();
    }
    return atMs;
}

function timestampAtOrAfter(atMs: number | undefined, minimumMs: number): number {
    return Math.max(minimumMs, timestamp(atMs));
}

function durationBetween(startMs: number, endMs: number | null): number | null {
    if (endMs === null) {
        return null;
    }
    return Math.max(0, endMs - startMs);
}

function createTimingAccumulator(): TimingAccumulator {
    return { samples: 0, totalMs: 0, lastMs: 0, maxMs: 0 };
}

function recordTiming(accumulator: TimingAccumulator, durationMs: number): void {
    if (!Number.isFinite(durationMs)) {
        return;
    }
    const normalizedDurationMs = Math.max(0, durationMs);
    accumulator.samples++;
    accumulator.totalMs += normalizedDurationMs;
    accumulator.lastMs = normalizedDurationMs;
    accumulator.maxMs = Math.max(accumulator.maxMs, normalizedDurationMs);
}

function snapshotTiming(accumulator: TimingAccumulator) {
    const averageMs = accumulator.samples === 0 ? 0 : accumulator.totalMs / accumulator.samples;
    return { ...accumulator, averageMs };
}

function isPending(status: DeviceReadinessStatus): boolean {
    return status === 'node-pending' || status === 'graph-pending' || status === 'content-pending';
}

class DeviceReadinessDiagnosticsCollector {
    private nextTokenId = 0;
    private generation = 0;
    private requested = 0;
    private nodeReady = 0;
    private graphReady = 0;
    private contentReady = 0;
    private playableReady = 0;
    private failed = 0;
    private cancelled = 0;
    private requestToNodeReadyMs = createTimingAccumulator();
    private requestToGraphReadyMs = createTimingAccumulator();
    private graphToContentReadyMs = createTimingAccumulator();
    private requestToPlayableReadyMs = createTimingAccumulator();
    private readonly records = new Map<string, DeviceReadinessRecord>();
    private readonly terminalOrder = new Set<string>();

    reset(): void {
        this.generation++;
        this.requested = 0;
        this.nodeReady = 0;
        this.graphReady = 0;
        this.contentReady = 0;
        this.playableReady = 0;
        this.failed = 0;
        this.cancelled = 0;
        this.requestToNodeReadyMs = createTimingAccumulator();
        this.requestToGraphReadyMs = createTimingAccumulator();
        this.graphToContentReadyMs = createTimingAccumulator();
        this.requestToPlayableReadyMs = createTimingAccumulator();
        this.records.clear();
        this.terminalOrder.clear();
    }

    begin(input: {
        deviceId: string;
        deviceType: string;
        requiresContent: boolean;
        atMs?: number;
    }): DeviceReadinessToken {
        const previous = this.records.get(input.deviceId);
        if (previous && isPending(previous.status)) {
            this.cancelled++;
        }
        this.deleteRecord(input.deviceId);
        this.nextTokenId++;
        const token: DeviceReadinessToken = Object.freeze({ deviceId: input.deviceId, tokenId: this.nextTokenId });
        this.records.set(input.deviceId, {
            token,
            deviceType: input.deviceType,
            requiresContent: input.requiresContent,
            requestedAtMs: timestamp(input.atMs),
            nodeReadyAtMs: null,
            graphReadyAtMs: null,
            contentReadyAtMs: null,
            playableReadyAtMs: null,
            failedAtMs: null,
            status: 'node-pending',
            failureStage: null,
        });
        this.requested++;
        return token;
    }

    markNodeReady(input: { token: DeviceReadinessToken; atMs?: number }): void {
        const record = this.currentRecord(input.token);
        if (!record || record.nodeReadyAtMs !== null || !isPending(record.status)) {
            return;
        }
        const atMs = timestampAtOrAfter(input.atMs, record.requestedAtMs);
        record.nodeReadyAtMs = atMs;
        record.status = 'graph-pending';
        this.nodeReady++;
        recordTiming(this.requestToNodeReadyMs, atMs - record.requestedAtMs);
    }

    markGraphReady(input: { token: DeviceReadinessToken; atMs?: number }): void {
        const record = this.currentRecord(input.token);
        if (!record || record.graphReadyAtMs !== null || !isPending(record.status)) {
            return;
        }
        const candidateAtMs = timestamp(input.atMs);
        if (record.nodeReadyAtMs === null) {
            this.markNodeReady({ token: input.token, atMs: candidateAtMs });
        }
        const atMs = Math.max(record.requestedAtMs, record.nodeReadyAtMs ?? record.requestedAtMs, candidateAtMs);
        record.graphReadyAtMs = atMs;
        this.graphReady++;
        recordTiming(this.requestToGraphReadyMs, atMs - record.requestedAtMs);
        if (!record.requiresContent) {
            this.markPlayable(record, atMs);
            return;
        }
        record.status = 'content-pending';
        if (record.contentReadyAtMs !== null) {
            recordTiming(this.graphToContentReadyMs, record.contentReadyAtMs - atMs);
            this.markPlayable(record, Math.max(atMs, record.contentReadyAtMs));
        }
    }

    markContentSettled(input: { token: DeviceReadinessToken; outcome: DeviceContentLoadOutcome; atMs?: number }): void {
        const record = this.currentRecord(input.token);
        if (!record || !record.requiresContent || !isPending(record.status) || record.contentReadyAtMs !== null) {
            return;
        }
        if (input.outcome === 'cancelled') {
            this.cancelled++;
            this.deleteRecord(input.token.deviceId);
            return;
        }
        if (input.outcome === 'failed') {
            this.markFailed({ token: input.token, stage: 'content', atMs: input.atMs });
            return;
        }
        const minimumAtMs = record.graphReadyAtMs ?? record.requestedAtMs;
        const atMs = timestampAtOrAfter(input.atMs, minimumAtMs);
        record.contentReadyAtMs = atMs;
        this.contentReady++;
        if (record.graphReadyAtMs !== null) {
            recordTiming(this.graphToContentReadyMs, atMs - record.graphReadyAtMs);
            this.markPlayable(record, Math.max(atMs, record.graphReadyAtMs));
        }
    }

    markFailed(input: { token: DeviceReadinessToken; stage: DeviceReadinessFailureStage; atMs?: number }): void {
        const record = this.currentRecord(input.token);
        if (!record || record.status === 'failed') {
            return;
        }
        const minimumAtMs = Math.max(
            record.requestedAtMs,
            record.nodeReadyAtMs ?? record.requestedAtMs,
            record.graphReadyAtMs ?? record.requestedAtMs,
            record.contentReadyAtMs ?? record.requestedAtMs
        );
        record.failedAtMs = timestampAtOrAfter(input.atMs, minimumAtMs);
        record.status = 'failed';
        record.failureStage = input.stage;
        this.failed++;
        this.retainTerminal(record);
    }

    cancel(token: DeviceReadinessToken): void {
        const record = this.currentRecord(token);
        if (!record) {
            return;
        }
        if (isPending(record.status)) {
            this.cancelled++;
        }
        this.deleteRecord(token.deviceId);
    }

    removeDevice(token: DeviceReadinessToken): void {
        this.cancel(token);
    }

    getLoadState(token: DeviceReadinessToken): 'ready' | 'pending' | 'failed' | null {
        const record = this.currentRecord(token);
        if (!record) {
            return null;
        }
        if (record.status === 'ready' || record.status === 'failed') {
            return record.status;
        }
        return 'pending';
    }

    snapshot(): AudioEngineDeviceReadinessDiagnostics {
        return {
            generation: this.generation,
            counts: {
                requested: this.requested,
                nodeReady: this.nodeReady,
                graphReady: this.graphReady,
                contentReady: this.contentReady,
                playableReady: this.playableReady,
                failed: this.failed,
                cancelled: this.cancelled,
            },
            timing: {
                requestToNodeReadyMs: snapshotTiming(this.requestToNodeReadyMs),
                requestToGraphReadyMs: snapshotTiming(this.requestToGraphReadyMs),
                graphToContentReadyMs: snapshotTiming(this.graphToContentReadyMs),
                requestToPlayableReadyMs: snapshotTiming(this.requestToPlayableReadyMs),
            },
            devices: [...this.records.values()].map((record) => ({
                deviceId: record.token.deviceId,
                deviceType: record.deviceType,
                status: record.status,
                failureStage: record.failureStage,
                requestToNodeReadyMs: durationBetween(record.requestedAtMs, record.nodeReadyAtMs),
                requestToGraphReadyMs: durationBetween(record.requestedAtMs, record.graphReadyAtMs),
                graphToContentReadyMs:
                    record.graphReadyAtMs === null
                        ? null
                        : durationBetween(record.graphReadyAtMs, record.contentReadyAtMs),
                requestToPlayableReadyMs: durationBetween(record.requestedAtMs, record.playableReadyAtMs),
                requestToFailureMs: durationBetween(record.requestedAtMs, record.failedAtMs),
            })),
        };
    }

    private currentRecord(token: DeviceReadinessToken): DeviceReadinessRecord | null {
        const record = this.records.get(token.deviceId);
        if (!record || record.token !== token) {
            return null;
        }
        return record;
    }

    private markPlayable(record: DeviceReadinessRecord, atMs: number): void {
        if (record.playableReadyAtMs !== null || record.status === 'failed') {
            return;
        }
        record.playableReadyAtMs = atMs;
        record.status = 'ready';
        this.playableReady++;
        recordTiming(this.requestToPlayableReadyMs, atMs - record.requestedAtMs);
        this.retainTerminal(record);
    }

    private retainTerminal(record: DeviceReadinessRecord): void {
        const deviceId = record.token.deviceId;
        this.records.delete(deviceId);
        this.records.set(deviceId, record);
        this.terminalOrder.delete(deviceId);
        this.terminalOrder.add(deviceId);
        if (this.terminalOrder.size <= MAX_RETAINED_TERMINAL_RECORDS) {
            return;
        }
        const oldestDeviceId = this.terminalOrder.values().next().value;
        if (oldestDeviceId !== undefined) {
            this.deleteRecord(oldestDeviceId);
        }
    }

    private deleteRecord(deviceId: string): void {
        this.records.delete(deviceId);
        this.terminalOrder.delete(deviceId);
    }
}

export function createDeviceReadinessDiagnostics(): DeviceReadinessDiagnosticsCollector {
    return new DeviceReadinessDiagnosticsCollector();
}
