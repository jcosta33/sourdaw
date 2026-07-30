import { logger } from '#/infra/logger/appLogger';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

type DeviceTelemetryPoll = (time: DOMHighResTimeStamp, deltaMs: number) => void;

type RegisterDeviceTelemetrySourceInput = {
    deviceId: string;
    poll: DeviceTelemetryPoll;
};

type SubscribeDeviceTelemetryDemandInput = {
    deviceId: string;
};

type SourceRegistration = {
    deviceId: string;
    failed: boolean;
    next: SourceRegistration | null;
    poll: DeviceTelemetryPoll;
    previous: SourceRegistration | null;
    state: 'pending' | 'active' | 'pending-removal' | 'cancelled';
};

type DemandSubscription = {
    deviceId: string;
    state: 'pending' | 'active' | 'pending-removal' | 'cancelled';
};

type PendingMutation =
    | { kind: 'add-source'; source: SourceRegistration }
    | { kind: 'remove-source'; source: SourceRegistration }
    | { kind: 'add-demand'; subscription: DemandSubscription }
    | { kind: 'remove-demand'; subscription: DemandSubscription };

const SCHEDULER_ID = 'audio-engine-device-telemetry';
const sources = new Map<string, SourceRegistration>();
const demands = new Map<string, Set<DemandSubscription>>();
const pendingMutations: PendingMutation[] = [];
let sourceHead: SourceRegistration | null = null;
let sourceTail: SourceRegistration | null = null;
let activeDemandSubscriptions = 0;
let isDispatching = false;
let isReconciling = false;
let reconcileRequested = false;
let schedulerRegistered = false;

function linkSource(source: SourceRegistration): void {
    source.previous = sourceTail;
    source.next = null;
    if (sourceTail) {
        sourceTail.next = source;
    } else {
        sourceHead = source;
    }
    sourceTail = source;
}

function unlinkSource(source: SourceRegistration): void {
    if (source.previous) {
        source.previous.next = source.next;
    } else {
        sourceHead = source.next;
    }
    if (source.next) {
        source.next.previous = source.previous;
    } else {
        sourceTail = source.previous;
    }
    source.previous = null;
    source.next = null;
}

function addSource(source: SourceRegistration): SourceRegistration | undefined {
    if (source.state === 'cancelled') {
        return undefined;
    }
    const previous = sources.get(source.deviceId);
    if (previous) {
        unlinkSource(previous);
        previous.state = 'cancelled';
    }
    sources.set(source.deviceId, source);
    linkSource(source);
    source.state = 'active';
    return previous;
}

function removeSource(source: SourceRegistration): void {
    if (sources.get(source.deviceId) === source) {
        sources.delete(source.deviceId);
        unlinkSource(source);
    }
    source.state = 'cancelled';
}

function restoreSource(source: SourceRegistration, previous: SourceRegistration | undefined): void {
    removeSource(source);
    if (previous) {
        previous.state = 'active';
        sources.set(previous.deviceId, previous);
        linkSource(previous);
    }
}

function addDemand(subscription: DemandSubscription): void {
    if (subscription.state === 'cancelled') {
        return;
    }
    let deviceDemands = demands.get(subscription.deviceId);
    if (!deviceDemands) {
        deviceDemands = new Set();
        demands.set(subscription.deviceId, deviceDemands);
    }
    deviceDemands.add(subscription);
    activeDemandSubscriptions += 1;
    subscription.state = 'active';
}

function removeDemand(subscription: DemandSubscription): void {
    const deviceDemands = demands.get(subscription.deviceId);
    if (deviceDemands?.delete(subscription)) {
        activeDemandSubscriptions -= 1;
        if (deviceDemands.size === 0) {
            demands.delete(subscription.deviceId);
        }
    }
    subscription.state = 'cancelled';
}

function hasEligibleSource(): boolean {
    let source = sourceHead;
    while (source) {
        if (!source.failed && demands.has(source.deviceId)) {
            return true;
        }
        source = source.next;
    }
    return false;
}

function requiresAnotherReconciliation(): boolean {
    return reconcileRequested || hasEligibleSource() !== schedulerRegistered;
}

function reconcileScheduler(): void {
    if (isReconciling) {
        reconcileRequested = true;
        return;
    }
    isReconciling = true;
    let firstFailure: unknown;
    let failed = false;
    try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                do {
                    reconcileRequested = false;
                    const shouldRun = hasEligibleSource();
                    if (shouldRun && !schedulerRegistered) {
                        animationScheduler.register(SCHEDULER_ID, tick);
                        schedulerRegistered = true;
                    } else if (!shouldRun && schedulerRegistered) {
                        schedulerRegistered = false;
                        animationScheduler.unregister(SCHEDULER_ID);
                    }
                } while (requiresAnotherReconciliation());
                break;
            } catch (error) {
                if (!failed) {
                    failed = true;
                    firstFailure = error;
                }
                if (!reconcileRequested) {
                    break;
                }
            }
        }
    } finally {
        isReconciling = false;
    }
    if (failed) {
        throw firstFailure;
    }
}

function reconcileAfterRollback(): void {
    try {
        reconcileScheduler();
    } catch (error) {
        logger.warn('[DeviceTelemetryScheduler] Rollback reconciliation failed:', error);
    }
}

function flushPendingMutations(): boolean {
    if (pendingMutations.length === 0) {
        return false;
    }
    for (let index = 0; index < pendingMutations.length; index += 1) {
        const mutation = pendingMutations[index]!;
        if (mutation.kind === 'add-source') {
            addSource(mutation.source);
        } else if (mutation.kind === 'remove-source') {
            removeSource(mutation.source);
        } else if (mutation.kind === 'add-demand') {
            addDemand(mutation.subscription);
        } else {
            removeDemand(mutation.subscription);
        }
    }
    pendingMutations.length = 0;
    return true;
}

function tick(time: DOMHighResTimeStamp, deltaMs: number): void {
    isDispatching = true;
    let sourceFailed = false;
    try {
        let source = sourceHead;
        while (source) {
            if (!source.failed && demands.has(source.deviceId)) {
                try {
                    source.poll(time, deltaMs);
                } catch (error) {
                    source.failed = true;
                    sourceFailed = true;
                    logger.warn(`[DeviceTelemetryScheduler] Source for "${source.deviceId}" threw:`, error);
                }
            }
            source = source.next;
        }
    } finally {
        const shouldReconcile = flushPendingMutations() || sourceFailed;
        isDispatching = false;
        if (shouldReconcile) {
            reconcileScheduler();
        }
    }
}

export function registerDeviceTelemetrySource(input: RegisterDeviceTelemetrySourceInput): () => void {
    const source: SourceRegistration = {
        deviceId: input.deviceId,
        failed: false,
        next: null,
        poll: input.poll,
        previous: null,
        state: isDispatching ? 'pending' : 'active',
    };
    if (isDispatching) {
        pendingMutations.push({ kind: 'add-source', source });
    } else {
        const previous = addSource(source);
        try {
            reconcileScheduler();
        } catch (error) {
            restoreSource(source, previous);
            reconcileAfterRollback();
            throw error;
        }
    }

    return () => {
        if (source.state === 'cancelled' || source.state === 'pending-removal') {
            return;
        }
        if (source.state === 'pending') {
            source.state = 'cancelled';
            return;
        }
        if (isDispatching) {
            source.state = 'pending-removal';
            pendingMutations.push({ kind: 'remove-source', source });
        } else {
            removeSource(source);
            reconcileScheduler();
        }
    };
}

export function subscribeDeviceTelemetryDemand(input: SubscribeDeviceTelemetryDemandInput): () => void {
    const subscription: DemandSubscription = {
        deviceId: input.deviceId,
        state: isDispatching ? 'pending' : 'active',
    };
    if (isDispatching) {
        pendingMutations.push({ kind: 'add-demand', subscription });
    } else {
        addDemand(subscription);
        try {
            reconcileScheduler();
        } catch (error) {
            removeDemand(subscription);
            reconcileAfterRollback();
            throw error;
        }
    }

    return () => {
        if (subscription.state === 'cancelled' || subscription.state === 'pending-removal') {
            return;
        }
        if (subscription.state === 'pending') {
            subscription.state = 'cancelled';
            return;
        }
        if (isDispatching) {
            subscription.state = 'pending-removal';
            pendingMutations.push({ kind: 'remove-demand', subscription });
        } else {
            removeDemand(subscription);
            reconcileScheduler();
        }
    };
}

export function getDeviceTelemetrySchedulerDiagnostics(): {
    activeDemandSubscriptions: number;
    activeSources: number;
    eligibleSources: number;
    pendingMutations: number;
    schedulerRegistered: boolean;
} {
    let eligibleSources = 0;
    let source = sourceHead;
    while (source) {
        if (!source.failed && demands.has(source.deviceId)) {
            eligibleSources += 1;
        }
        source = source.next;
    }
    return {
        activeDemandSubscriptions,
        activeSources: sources.size,
        eligibleSources,
        pendingMutations: pendingMutations.length,
        schedulerRegistered,
    };
}
