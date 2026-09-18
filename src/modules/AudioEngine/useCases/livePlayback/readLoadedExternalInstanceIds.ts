/**
 * The external plugin instances that have a parameter snapshot in
 * `externalPluginParameterStore` — loaded, whether or not the native engine
 * has attached them yet (#4355).
 *
 * Distinct from `readAttachedExternalInstanceIds`: `activateExternalPlugin`
 * writes a snapshot as soon as `loadPlugin` resolves, before the engine
 * reports the instance attached. A plugin loaded while the transport is
 * parked writes `engineAttached: false` — a pending attachment, not a failed
 * one — and sounds on the very next Play. The offline device chain's plugin
 * refusal has to catch that instance too, or a project rendered before the
 * first Play degrades to a dry bake that never matches what the session
 * plays once it starts. `readAttachedExternalInstanceIds` stays scoped to
 * callers that need the live engine's current attach state — the carrier
 * law, the note sink, the MIDI writer; do not widen it or fold it into this
 * reader.
 *
 * A snapshot's absence is not "loaded": an instance nothing activated in this
 * generation — a never-loaded device, a duplicated track, a track template —
 * has no snapshot either, so it is left out here exactly as it is from the
 * attached set.
 *
 * The browser build's `loadPlugin` stub always resolves `engine_plugin_id:
 * null` and still writes a snapshot, so a browser-build project reports a
 * loaded instance that never sounds. Callers must additionally gate on
 * `isDesktopRuntime()` before treating a hit here as live.
 */

import { externalPluginParameterStore } from '#/modules/PluginHost/stores';

export function readLoadedExternalInstanceIds(): ReadonlySet<string> {
    const byInstanceId = externalPluginParameterStore.value?.byInstanceId ?? {};
    return new Set(Object.keys(byInstanceId));
}
