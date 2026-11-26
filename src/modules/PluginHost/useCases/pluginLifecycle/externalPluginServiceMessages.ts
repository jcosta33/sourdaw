/**
 * The out-of-service message `watchExternalPluginService` wrote to each
 * instance's slot, by instance id.
 *
 * Remembered so that the instance coming back in service clears only the entry
 * this watcher wrote: a slot something else has since rewritten (a failed
 * restore, an unresponsive plugin) is not this watcher's to reset. An entry
 * leaves when the instance is forgotten or the graph generation ends.
 *
 * Ephemeral runtime state, not project truth.
 */
export const externalPluginServiceMessages = new Map<string, string>();
