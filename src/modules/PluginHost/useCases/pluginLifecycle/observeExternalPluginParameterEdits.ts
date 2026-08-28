import {
    type ExternalPluginParameterEdit,
    externalPluginParameterEditObservers,
} from './externalPluginParameterEditObservers';
import { watchExternalPluginParameterEvents } from './watchExternalPluginParameterEvents';

/**
 * Observe every edit a hosted plugin makes to its own parameters, and answer
 * with how to stop.
 *
 * The edits arrive in the order the plugin produced them, with
 * `gestureBegin`/`gestureEnd` bracketing the values of one continuous ride. That
 * bracketing is the point: it is what lets a recorder in touch or latch mode
 * tell a control the user is holding from a run of separate nudges, which is a
 * distinction no stream of bare values can carry.
 *
 * A use case rather than the bridge listener itself, because the callers are
 * other modules: the repository is this module's private I/O, and what crosses
 * the barrel is the edit, not the transport that carried it.
 */
export function observeExternalPluginParameterEdits(observe: (edit: ExternalPluginParameterEdit) => void): () => void {
    externalPluginParameterEditObservers.add(observe);
    // An observer registered before any plugin loaded would otherwise wait for
    // an activation to start the subscription, and miss every edit until then.
    watchExternalPluginParameterEvents();
    return () => {
        externalPluginParameterEditObservers.delete(observe);
    };
}
