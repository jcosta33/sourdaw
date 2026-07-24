import { logger } from '#/infra/logger/appLogger';

import { onPluginLatencyChanged } from '../../repositories/pluginBridge/onPluginLatencyChanged';

import { externalLatencyReporters } from './externalLatencyReporters';

/**
 * The single live subscription, or `null` when none is running. Held as the
 * in-flight promise so concurrent activations cannot start a second listener
 * while the first is still resolving.
 */
let subscription: Promise<() => void> | null = null;

/**
 * Ensure the `plugin-latency-changed` subscription is live, routing each change
 * to the sink registered for that plugin instance.
 *
 * Idempotent: the first activation starts it and every later one reuses it. If
 * subscribing fails the slot is released so a later activation retries rather
 * than leaving latency changes permanently unheard.
 */
export function watchExternalPluginLatency(): void {
    if (subscription) {
        return;
    }

    subscription = onPluginLatencyChanged((change) => {
        const report = externalLatencyReporters.get(change.instance_id);
        if (!report) {
            // Unloaded between the host's push and this dispatch.
            return;
        }
        report(change.latency_ms);
    }).catch((error: unknown) => {
        subscription = null;
        logger.warn(`Failed to subscribe to native plugin latency changes: ${String(error)}`);
        return () => {};
    });
}
