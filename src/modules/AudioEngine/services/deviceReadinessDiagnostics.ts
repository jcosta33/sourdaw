export type DeviceReadinessToken = {
    readonly deviceId: string;
    readonly tokenId: number;
};

export type DeviceContentLoadOutcome = 'ready' | 'failed' | 'cancelled';
export type DeviceReadinessFailureStage = 'node' | 'graph' | 'content';

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

function trimTerminalRecords(): void {
    let terminalRecords = 0;
    for (const record of records.values()) {
        if (!isPending(record.status)) {
            terminalRecords++;
        }
    }
    if (terminalRecords <= MAX_RETAINED_TERMINAL_RECORDS) {
        return;
    }
    for (const [deviceId, record] of records) {
        if (isPending(record.status)) {
            continue;
        }
        records.delete(deviceId);
        terminalRecords--;
        if (terminalRecords === MAX_RETAINED_TERMINAL_RECORDS) {
            return;
        }
    }
}

function moveTerminalRecordToNewest(record: DeviceReadinessRecord): void {
    records.delete(record.token.deviceId);
    records.set(record.token.deviceId, record);
}

let nextTokenId = 0;
let requested = 0;
let nodeReady = 0;
let graphReady = 0;
let contentReady = 0;
let playableReady = 0;
let failed = 0;
let cancelled = 0;
let requestToNodeReadyMs = createTimingAccumulator();
let requestToGraphReadyMs = createTimingAccumulator();
let graphToContentReadyMs = createTimingAccumulator();
let requestToPlayableReadyMs = createTimingAccumulator();
const records = new Map<string, DeviceReadinessRecord>();

function currentRecord(token: DeviceReadinessToken): DeviceReadinessRecord | null {
    const record = records.get(token.deviceId);
    if (!record || record.token !== token) {
        return null;
    }
    return record;
}

function markPlayable(record: DeviceReadinessRecord, atMs: number): void {
    if (record.playableReadyAtMs !== null || record.status === 'failed') {
        return;
    }
    record.playableReadyAtMs = atMs;
    record.status = 'ready';
    playableReady++;
    recordTiming(requestToPlayableReadyMs, atMs - record.requestedAtMs);
    moveTerminalRecordToNewest(record);
    trimTerminalRecords();
}

export const deviceReadinessDiagnostics = {
    reset(): void {
        requested = 0;
        nodeReady = 0;
        graphReady = 0;
        contentReady = 0;
        playableReady = 0;
        failed = 0;
        cancelled = 0;
        requestToNodeReadyMs = createTimingAccumulator();
        requestToGraphReadyMs = createTimingAccumulator();
        graphToContentReadyMs = createTimingAccumulator();
        requestToPlayableReadyMs = createTimingAccumulator();
        records.clear();
    },

    begin(input: {
        deviceId: string;
        deviceType: string;
        requiresContent: boolean;
        atMs?: number;
    }): DeviceReadinessToken {
        const previous = records.get(input.deviceId);
        if (previous && isPending(previous.status)) {
            cancelled++;
        }
        records.delete(input.deviceId);
        nextTokenId++;
        const token: DeviceReadinessToken = Object.freeze({ deviceId: input.deviceId, tokenId: nextTokenId });
        records.set(input.deviceId, {
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
        requested++;
        return token;
    },

    markNodeReady(input: { token: DeviceReadinessToken; atMs?: number }): void {
        const record = currentRecord(input.token);
        if (!record || record.nodeReadyAtMs !== null || !isPending(record.status)) {
            return;
        }
        const atMs = timestampAtOrAfter(input.atMs, record.requestedAtMs);
        record.nodeReadyAtMs = atMs;
        record.status = 'graph-pending';
        nodeReady++;
        recordTiming(requestToNodeReadyMs, atMs - record.requestedAtMs);
    },

    markGraphReady(input: { token: DeviceReadinessToken; atMs?: number }): void {
        const record = currentRecord(input.token);
        if (!record || record.graphReadyAtMs !== null || !isPending(record.status)) {
            return;
        }
        const candidateAtMs = timestamp(input.atMs);
        if (record.nodeReadyAtMs === null) {
            deviceReadinessDiagnostics.markNodeReady({ token: input.token, atMs: candidateAtMs });
        }
        const atMs = Math.max(record.requestedAtMs, record.nodeReadyAtMs ?? record.requestedAtMs, candidateAtMs);
        record.graphReadyAtMs = atMs;
        graphReady++;
        recordTiming(requestToGraphReadyMs, atMs - record.requestedAtMs);
        if (!record.requiresContent) {
            markPlayable(record, atMs);
            return;
        }
        record.status = 'content-pending';
        if (record.contentReadyAtMs !== null) {
            recordTiming(graphToContentReadyMs, record.contentReadyAtMs - atMs);
            markPlayable(record, Math.max(atMs, record.contentReadyAtMs));
        }
    },

    markContentSettled(input: { token: DeviceReadinessToken; outcome: DeviceContentLoadOutcome; atMs?: number }): void {
        const record = currentRecord(input.token);
        if (!record || !record.requiresContent || !isPending(record.status)) {
            return;
        }
        if (record.contentReadyAtMs !== null) {
            return;
        }
        if (input.outcome === 'cancelled') {
            cancelled++;
            records.delete(input.token.deviceId);
            return;
        }
        if (input.outcome === 'failed') {
            deviceReadinessDiagnostics.markFailed({ token: input.token, stage: 'content', atMs: input.atMs });
            return;
        }
        const minimumAtMs = record.graphReadyAtMs ?? record.requestedAtMs;
        const atMs = timestampAtOrAfter(input.atMs, minimumAtMs);
        record.contentReadyAtMs = atMs;
        contentReady++;
        if (record.graphReadyAtMs !== null) {
            recordTiming(graphToContentReadyMs, atMs - record.graphReadyAtMs);
            markPlayable(record, Math.max(atMs, record.graphReadyAtMs));
        }
    },

    markFailed(input: { token: DeviceReadinessToken; stage: DeviceReadinessFailureStage; atMs?: number }): void {
        const record = currentRecord(input.token);
        if (!record || !isPending(record.status)) {
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
        failed++;
        moveTerminalRecordToNewest(record);
        trimTerminalRecords();
    },

    cancel(token: DeviceReadinessToken): void {
        const record = currentRecord(token);
        if (!record) {
            return;
        }
        if (isPending(record.status)) {
            cancelled++;
        }
        records.delete(token.deviceId);
    },

    removeDevice(token: DeviceReadinessToken): void {
        const record = currentRecord(token);
        if (!record) {
            return;
        }
        if (isPending(record.status)) {
            cancelled++;
        }
        records.delete(token.deviceId);
    },

    snapshot() {
        return {
            counts: { requested, nodeReady, graphReady, contentReady, playableReady, failed, cancelled },
            timing: {
                requestToNodeReadyMs: snapshotTiming(requestToNodeReadyMs),
                requestToGraphReadyMs: snapshotTiming(requestToGraphReadyMs),
                graphToContentReadyMs: snapshotTiming(graphToContentReadyMs),
                requestToPlayableReadyMs: snapshotTiming(requestToPlayableReadyMs),
            },
            devices: [...records.values()].map((record) => ({
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
    },
};
