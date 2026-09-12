import { type DeviceStateChunk } from '#/modules/Arrangement/stores';
import { projectLevainDeviceStateToNativePatch } from '#/modules/Levain/useCases';
import { projectToasterKitToNativePatch } from '#/modules/Toaster/useCases';
import { type NativeDspDeviceType, resolveNativeDspDeviceType } from '#/utils/nativeDspDeviceTypes';

export type ProjectNativeDeviceStateInput = {
    /** Device type, as `projectDeviceForNativeBody` read it off the project. */
    deviceType: string;
    /** Project state that configures the device beyond `parameterValues`. */
    deviceState: DeviceStateChunk | undefined;
};

/** What one native device's `deviceState` projects to, once it exists. */
type ProjectDeviceState = (deviceState: DeviceStateChunk) => Readonly<Record<string, number>> | null;

/**
 * Every native-DSP device, and what of its `deviceState` a native body needs
 * folded into `parameterValues`.
 *
 * Mirrors `OFFLINE_DEVICE_HYDRATION` in `prepareOfflineDeviceSetup.ts`. `null`
 * is a decision, not a gap: most native bodies' whole DSP surface already
 * arrives as `parameterValues`, so there is nothing else to project. The table
 * stays exhaustive over `NativeDspDeviceType` so a new native device fails to
 * compile here until someone decides whether its native body needs anything
 * `parameterValues` cannot carry — the same reason that table exists.
 *
 * Ordered to match `NATIVE_DSP_DEVICE_TYPES` so the two tables read as one list.
 */
const NATIVE_DEVICE_STATE_PROJECTIONS: Record<NativeDspDeviceType, ProjectDeviceState | null> = {
    // Its patch reaches project truth as plain numbers; nothing else to project.
    fermenter: null,
    // Its kit — engine type, tuning, decay, tone, drive, filtering, sends — is
    // not a `parameterValues` entry at all: it is pushed as control writes from
    // `deviceState` (`projectToasterKitToEngineMessages`), so the native body
    // needs it folded in here the same way the web offline path pushes it after
    // construction (`prepareOfflineToaster`).
    toaster: (deviceState) => projectToasterKitToNativePatch({ deviceState }),
    // The sampler's articulation choice is a string in `deviceState`, not a
    // `parameterValues` entry, and the engine takes it as the numeric
    // `current_articulation`. Its sample zones are not projected at all: they
    // reach the engine as a staged bank, which `nativeSampleBanks.ts` answers
    // for through this sink's own bank door.
    levain: (deviceState) => projectLevainDeviceStateToNativePatch({ deviceState }),
    // No native body: Crumbs streaming is native-only through its own registry,
    // not through a built-in body.
    'builtin-crumbs': null,
    // Its knobs are a `parameterValues` table (`GrandBouleDspParamNames.ts`).
    // Its own `deviceState` also carries a piano-morph state
    // (`GrandBouleDeviceState.ts`) whose derived overrides
    // (`projectGrandBouleMorphState`) reach the web offline worklet the same
    // way Toaster's kit does — a parallel gap this projection does not close.
    // A native Grand Boule strip with morph enabled renders the unmorphed base
    // model until that gap has its own lane.
    'grand-boule': null,
    // Every control the panel owns is a `GlutenPatch` key encoded to a number
    // and persisted as a `parameterValues` entry; nothing else to project.
    gluten: null,
    // Same shape as Gluten: every `CrustPatch` key is a `parameterValues` entry.
    crust: null,
    // The engine's own camelCase ids are the project's ids; nothing beyond
    // `parameterValues` for this body either.
    bacteria: null,
    // Same shape as Bacteria, including the dynamically named neural-profile
    // keys — all of them are `parameterValues` entries.
    grinder: null,
    // Its module order travels as `chain_order_N` parameters, already numeric
    // `parameterValues` entries; nothing else to project.
    proof: null,
    // The reverb's whole vocabulary — engine selection, decay-rate EQ, the
    // internal damping version — is a `parameterValues` entry.
    'dutch-oven': null,
    // No native body: the Tuner's `scoring` engine has no `write-device-parameter`
    // vocabulary of its own to receive a projected record.
    'native-scoring': null,
    // Knead's closed vocabulary is entirely `parameterValues` entries.
    knead: null,
};

/**
 * A device's `deviceState` as the numeric record its native body needs merged
 * into `parameterValues` (#3124).
 *
 * Registered as `AudioDeviceRuntimeSink.projectNativeDeviceState`, the
 * live/offline-via-native mirror of `prepareOfflineDeviceSetup` for the web
 * offline worklet path: both exist because `Device.deviceState` is opaque and
 * only the owning module may decode it, and both dispatch from the
 * composition root because the mapper (`buildDeviceChain` /
 * `projectDeviceForNativeBody`) may not import a device module's use cases
 * directly.
 */
export function projectNativeDeviceState(
    input: ProjectNativeDeviceStateInput
): Readonly<Record<string, number>> | null {
    const deviceType = resolveNativeDspDeviceType(input.deviceType);
    if (!deviceType || !input.deviceState) {
        return null;
    }

    const project = NATIVE_DEVICE_STATE_PROJECTIONS[deviceType];
    if (!project) {
        return null;
    }

    return project(input.deviceState);
}
