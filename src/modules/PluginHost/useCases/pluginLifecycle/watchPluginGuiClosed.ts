import { logger } from '#/infra/logger/appLogger';

import { onPluginGuiClosed } from '../../repositories/pluginBridge/onPluginGuiClosed';

import { recordPluginGuiState } from './pluginGuiState';

/**
 * The single live subscription, or `null` when none is running. Held as the
 * in-flight promise so concurrent opens cannot start a second listener while the
 * first is still resolving.
 */
let subscription: Promise<() => void> | null = null;

/**
 * Ensure the `plugin-gui-closed` subscription is live, so an editor the OS ended
 * stops being shown as open.
 *
 * Idempotent: the first open starts it and every later one reuses it. If
 * subscribing fails the slot is released so a later open retries rather than
 * leaving every OS-initiated close permanently unheard.
 */
export function watchPluginGuiClosed(): void {
    if (subscription) {
        return;
    }

    subscription = onPluginGuiClosed((closed) => {
        recordPluginGuiState(closed.instance_id, { isOpen: false });
    }).catch((error: unknown) => {
        subscription = null;
        logger.warn(`Failed to subscribe to native plugin editor closes: ${String(error)}`);
        return () => {};
    });
}
