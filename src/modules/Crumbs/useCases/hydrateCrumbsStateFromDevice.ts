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

type CrumbsDeviceInput = {
    deviceState?: unknown;
    parameterValues?: Record<string, unknown>;
};

/** Reconstruct owner state from a supplied device without consulting the live project. */
export function hydrateCrumbsStateFromDevice(device: CrumbsDeviceInput): CrumbsState | null {
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
