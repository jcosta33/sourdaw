import { isPluginUnresponsiveFailure } from './isPluginUnresponsiveFailure';
import { pluginUnresponsiveMessage } from './pluginUnresponsiveMessage';

/** The message an activation failure shows: the unresponsive one when the host said so, else the reason itself. */
export function activationFailureMessage(pluginId: string, reason: string): string {
    return isPluginUnresponsiveFailure(reason) ? pluginUnresponsiveMessage(pluginId) : reason;
}
