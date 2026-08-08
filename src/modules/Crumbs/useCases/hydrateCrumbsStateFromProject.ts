import { trackStore } from '#/modules/Arrangement/stores';

import { fromCrumbsDeviceState } from '../models/CrumbsDeviceState';
import { CRUMBS_PARAM_TARGETS, CRUMBS_PERSISTED_PARAM_IDS } from '../models/CrumbsParameterMap';
import { defaultCrumbsState, type CrumbsState } from '../stores/crumbsStore';

/**
 * Fold a device's stored knob values onto a session state.
 *
 * Reads `Device.parameterValues` — the same map `setDeviceParameter` writes and
 * `projectTrackToLiveStrip` replays into the worklet — so the panel and the engine
 * come up on one value rather than two. Without this the engine would be correctly
 * restored while every knob still drew its module default, and the first touch of
 * any control would silently push the default back over the saved value.
 *
 * A parameter absent from the map keeps the incoming default. Absence is the normal
 * state for a device nobody has touched, and for a project saved by a build that
 * did not persist knobs at all; neither is a reason to overwrite anything.
 *
 * The whole map is optional for the same reason it is read defensively at all: this
 * is persisted data, and a document written by an older build can be missing a field
 * the current `Device` type declares as required.
 */
function withStoredParameters(state: CrumbsState, parameterValues?: Record<string, unknown>): CrumbsState {
    if (!parameterValues) {
        return state;
    }

    let next = state;
    for (const paramId of CRUMBS_PERSISTED_PARAM_IDS) {
        const stored = parameterValues[paramId];
        if (typeof stored !== 'number' || !Number.isFinite(stored)) {
            continue;
        }
        const target = CRUMBS_PARAM_TARGETS[paramId];
        if (target.kind === 'envelope') {
            next = { ...next, envelope: { ...next.envelope, [target.key]: stored } };
            continue;
        }
        if (target.kind === 'voiceStack') {
            next = { ...next, voiceStack: { ...next.voiceStack, [target.key]: stored } };
            continue;
        }
        next = { ...next, [target.key]: stored };
    }
    return next;
}

/**
 * Read back the Crumbs state project truth holds for a device, or `null` when it
 * holds none.
 *
 * The counterpart to `commitCrumbsDeviceState`, and the half that makes a loaded
 * sample survive a reload. Without it the document could hold a perfectly good
 * sample path that nothing ever reads back, which is what left every reopened
 * project's Crumbs tracks silent — no error, no prompt to relocate the file.
 *
 * A pure read, matching `hydrateToasterKitFromProject`. The waveform peaks are not
 * restored: they are a display cache the panel refetches from the backend at the
 * width it is actually rendering, and storing a few thousand floats per device in
 * the document to save that call would be a poor trade.
 *
 * Two independent stores are read back, and either one alone is enough to answer.
 * The device-state chunk carries the mode and the sample; `parameterValues` carries
 * the knobs. A device whose knobs were moved but which was never given a sample has
 * the second and not the first, and returning `null` for it — as this did while the
 * chunk was the only source — would restore its engine from `parameterValues` while
 * handing the panel a module default, so the first knob touch would push that
 * default back over the saved settings.
 */
export function hydrateCrumbsStateFromProject(deviceId: string): CrumbsState | null {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return null;
    }

    for (const track of tracks) {
        for (const device of track.devices) {
            if (device.id !== deviceId) {
                continue;
            }

            const withParameters = withStoredParameters(defaultCrumbsState, device.parameterValues);
            const playback = fromCrumbsDeviceState(device.deviceState);
            if (!playback) {
                // No readable chunk. Knob values still restore on their own; a state
                // identical to the default means project truth held nothing for this
                // device, which is what `null` reports.
                if (withParameters === defaultCrumbsState) {
                    return null;
                }
                return withParameters;
            }

            return {
                ...withParameters,
                mode: playback.mode,
                activeSample: playback.activeSample,
                // `setActiveSample` derives this from the sample on load; keep the
                // two paths agreeing so a reloaded sample plays at the pitch it was
                // saved at rather than at middle C.
                rootNote: playback.activeSample?.detectedRoot ?? defaultCrumbsState.rootNote,
            };
        }
    }
    return null;
}
