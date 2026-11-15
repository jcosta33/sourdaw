/**
 * Live plugin state read just before an app-initiated teardown destroyed its
 * native instance, keyed by that instance id, waiting for the same instance to
 * be activated again.
 *
 * Runtime state, never project truth: the project's `externalStateChunk` only
 * changes through Save/Export capture or an explicit replacement. An entry is
 * consumed once by the next activation of the same instance id and plugin, and
 * the whole store is dropped when the project session retires.
 */
export const carriedExternalPluginStates = new Map<string, { pluginId: string; stateChunk: string }>();
