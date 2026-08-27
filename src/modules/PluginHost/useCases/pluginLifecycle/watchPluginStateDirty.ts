import { onPluginStateDirty } from '../../repositories/pluginBridge/onPluginStateDirty';

/**
 * Call `onChanged` whenever a hosted plugin reports that its own state changed,
 * and answer with how to stop.
 *
 * A use case rather than the bridge listener itself, because the caller is
 * another module: the repository is this module's private I/O, and what crosses
 * the barrel is the fact, not the transport that carried it. The instance is
 * deliberately not passed on — a plugin reports that something changed, never
 * what, so the only consumer of this is project-level.
 */
export function watchPluginStateDirty(onChanged: () => void): Promise<() => void> {
    return onPluginStateDirty(() => {
        onChanged();
    });
}
