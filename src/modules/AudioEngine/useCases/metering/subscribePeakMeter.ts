import { logger } from '#/infra/logger/appLogger';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { audioEngine } from '../../repositories/createWebAudioEngine';

type PeakMeterFrameCallback = (peak: number, time: DOMHighResTimeStamp, deltaMs: number) => void;

type SubscribePeakMeterInput = {
    trackId: string | null;
    onFrame: PeakMeterFrameCallback;
};

type MeterSubscription = {
    callback: PeakMeterFrameCallback;
    state: 'pending' | 'active' | 'pending-removal' | 'cancelled';
};

type MeterSubscribers = {
    trackId: string | null;
    subscriptions: Set<MeterSubscription>;
};

type PendingMutation =
    | {
          kind: 'add';
          key: string;
          trackId: string | null;
          subscription: MeterSubscription;
      }
    | {
          kind: 'remove';
          key: string;
          subscription: MeterSubscription;
      };

const SCHEDULER_ID = 'audio-engine-peak-meters';
const MASTER_METER_KEY = 'master';
const subscribers = new Map<string, MeterSubscribers>();
const pendingMutations: PendingMutation[] = [];
let isDispatching = false;
let schedulerRegistered = false;

function meterKey(trackId: string | null): string {
    return trackId === null ? MASTER_METER_KEY : `track:${trackId}`;
}

function readPeak(trackId: string | null): number {
    return trackId === null ? audioEngine.getMasterPeakLevel() : audioEngine.getTrackPeakLevel(trackId);
}

function addSubscription(input: PendingMutation & { kind: 'add' }): void {
    if (input.subscription.state === 'cancelled') {
        return;
    }
    let meter = subscribers.get(input.key);
    if (!meter) {
        meter = { trackId: input.trackId, subscriptions: new Set() };
        subscribers.set(input.key, meter);
    }
    meter.subscriptions.add(input.subscription);
    input.subscription.state = 'active';
}

function removeSubscription(input: PendingMutation & { kind: 'remove' }): void {
    const meter = subscribers.get(input.key);
    meter?.subscriptions.delete(input.subscription);
    input.subscription.state = 'cancelled';
    if (meter?.subscriptions.size === 0) {
        subscribers.delete(input.key);
    }
}

function reconcileScheduler(): void {
    const shouldRun = subscribers.size > 0;
    if (shouldRun && !schedulerRegistered) {
        animationScheduler.register(SCHEDULER_ID, tick);
        schedulerRegistered = true;
    } else if (!shouldRun && schedulerRegistered) {
        animationScheduler.unregister(SCHEDULER_ID);
        schedulerRegistered = false;
    }
}

function flushPendingMutations(): void {
    for (const mutation of pendingMutations) {
        if (mutation.kind === 'add') {
            addSubscription(mutation);
        } else {
            removeSubscription(mutation);
        }
    }
    pendingMutations.length = 0;
}

function tick(time: DOMHighResTimeStamp, deltaMs: number): void {
    isDispatching = true;
    try {
        for (const [key, meter] of subscribers) {
            let peak: number;
            try {
                peak = readPeak(meter.trackId);
            } catch (error) {
                logger.warn(`[PeakMeterCoordinator] Failed to read "${key}":`, error);
                continue;
            }
            for (const subscription of meter.subscriptions) {
                try {
                    subscription.callback(peak, time, deltaMs);
                } catch (error) {
                    logger.warn(`[PeakMeterCoordinator] Subscriber for "${key}" threw:`, error);
                }
            }
        }
    } finally {
        flushPendingMutations();
        isDispatching = false;
        reconcileScheduler();
    }
}

export function subscribePeakMeter(input: SubscribePeakMeterInput): () => void {
    const key = meterKey(input.trackId);
    const subscription: MeterSubscription = {
        callback: input.onFrame,
        state: isDispatching ? 'pending' : 'active',
    };
    const addMutation: PendingMutation & { kind: 'add' } = {
        kind: 'add',
        key,
        trackId: input.trackId,
        subscription,
    };
    if (isDispatching) {
        pendingMutations.push(addMutation);
    } else {
        addSubscription(addMutation);
        try {
            reconcileScheduler();
        } catch (error) {
            removeSubscription({ kind: 'remove', key, subscription });
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
        const removeMutation: PendingMutation & { kind: 'remove' } = {
            kind: 'remove',
            key,
            subscription,
        };
        if (isDispatching) {
            subscription.state = 'pending-removal';
            pendingMutations.push(removeMutation);
        } else {
            removeSubscription(removeMutation);
            reconcileScheduler();
        }
    };
}
