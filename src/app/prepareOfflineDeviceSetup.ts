import { prepareCrumbsEngine } from '#/modules/Crumbs/useCases';
import { prepareOfflineGrandBoule } from '#/modules/GrandBoule/useCases';
import { prepareOfflineLevain } from '#/modules/Levain/useCases';
import { prepareOfflineProof } from '#/modules/Proof/useCases';
import { prepareOfflineToaster } from '#/modules/Toaster/useCases';
import { type NativeDspDeviceType, resolveNativeDspDeviceType } from '#/utils/nativeDspDeviceTypes';

export type PrepareOfflineDeviceSetupInput = {
    /** Id of the device being rendered; keys the project state that configures it. */
    deviceId: string;
    /** Device type, as the offline chain read it off the project. */
    deviceType: string;
    /** Project snapshot state for the owning module to validate and decode. */
    deviceState?: unknown;
    /** Worklet port of the offline instance the chain just built. */
    port: MessagePort;
    /** Aborts the setup on export cancellation or deadline. */
    signal?: AbortSignal;
};

/**
 * What one device needs posted at its freshly built offline worklet.
 *
 * Takes the whole input so an entry uses as much or as little of it as its device
 * needs — Levain wants the abort signal because it fetches, Proof does not.
 */
type HydrateOfflineDevice = (input: PrepareOfflineDeviceSetupInput) => void | Promise<void>;

/**
 * Every native-DSP device, and what it needs before it can render offline.
 *
 * **`null` is a decision, not a gap.** It means "this device's entire state
 * reaches the offline node as plain `parameterValues`, which the strategy already
 * replays". Eight of twelve are genuinely in that position, which is what makes an
 * exhaustive table cheap enough to be worth having.
 *
 * The table is exhaustive over `NativeDspDeviceType`, so adding a native device to
 * `NATIVE_DSP_DEVICE_TYPES` without adding a row here does not compile. That is
 * the point of the shape. The defect class it replaces was devices silently
 * rendering unconfigured — Levain bounced digital silence, Toaster bounced the
 * engine's built-in drum kit — and each was found by ear, months apart, because
 * nothing required an answer at the moment the device was added. A `tsc` failure
 * demands the answer up front, and `null` is a fine answer that someone has at
 * least had to write down.
 *
 * Ordered to match `NATIVE_DSP_DEVICE_TYPES` so the two read as one list.
 */
const OFFLINE_DEVICE_HYDRATION: Record<NativeDspDeviceType, HydrateOfflineDevice | null> = {
    // Its patch reaches project truth as plain numbers, which the offline strategy
    // already replays. There is nothing else to send.
    fermenter: null,
    // Its per-pad kit — engine type, tuning, decay, tone, drive, filtering, sends
    // — is pushed after construction and is not in `parameterValues`, so an export
    // rendered the engine's built-in kit: right notes, wrong drums.
    toaster: ({ deviceId, deviceState, port }) => prepareOfflineToaster({ deviceId, deviceState, port }),
    // The only entry that fetches: its sample zones come over the network, so it
    // is also the only one that needs the abort signal.
    levain: ({ deviceId, port, signal }) => prepareOfflineLevain({ deviceId, port, signal }),
    // Emphatically not `null`. A `CrumbsInstance` is constructed with an empty
    // sample pool, and `CrumbsEngine::note_on` returns before allocating a voice
    // when there is no active sample — so an unhydrated Crumbs renders digital
    // silence no matter how faithfully its parameters were replayed. The sample
    // is not expressible as a `parameterValue`: it is decoded PCM that only
    // exists on disk, read over the native bridge and transferred in. The
    // operating mode is the same story — it lives on `crumbsStore`, not in
    // `Device.parameterValues`.
    //
    // Takes the signal for the same reason Levain does: this one does file I/O
    // and a decode, so a cancelled export must be able to stop it.
    //
    // Slice markers are deliberately *not* part of this. They are UI state
    // today: `CrumbsEngine::note_on` always triggers at `start_frame: 0` and the
    // `crumbs::modes` structs are not wired into the engine on either platform,
    // so markers change no rendered sample in the session either. Hydrating them
    // here would make the export differ from live — the same trap as Toaster's
    // kit above. They belong here once the engine consumes them, not before.
    'builtin-crumbs': async ({ deviceId, port, signal }) => {
        const outcome = await prepareCrumbsEngine({ deviceId, port, signal });
        if (outcome === 'ready') {
            return;
        }
        signal?.throwIfAborted();
        throw new Error(`Crumbs content preparation ${outcome} for ${deviceId}`);
    },
    'grand-boule': ({ deviceState, port }) => prepareOfflineGrandBoule({ deviceState, port }),
    gluten: null,
    // Every control the panel owns is a `CrustPatch` key, and every one of them
    // is encoded to a number by `crustParamBridge` and persisted as a
    // `parameterValue` — the strategy already replays all of them. The meter
    // state is read-only telemetry, and the true-peak hold is a UI affordance,
    // so there is nothing an export needs that a flat map of numbers misses.
    crust: null,
    bacteria: null,
    grinder: null,
    // Its module order is persisted as `chain_order_N` params the worklet ignores;
    // only a `reorder` message moves the chain, and nothing offline sent one, so
    // every export rendered the default order.
    proof: ({ deviceId, port }) => prepareOfflineProof({ deviceId, port }),
    'dutch-oven': null,
    'native-scoring': null,
    knead: null,
};

/**
 * Give an offline device the state its live counterpart gets from somewhere other
 * than `Device.parameterValues`.
 *
 * The offline render builds its nodes through a different registry than live
 * playback (`nativeDspDeviceFactories` versus `wasmDeviceRegistry`), so none of
 * the per-device setup the live descriptors perform ever runs for an export.
 * Everything a device needs beyond a flat map of numbers therefore has to be
 * re-established here, once per device the chain builds.
 *
 * This lives in the composition root because the decision is cross-module:
 * `buildDeviceChain` may not import a device module's use cases (the engine
 * registry and the module's bridge would form a cycle), so it hands the device
 * type over through `audioDeviceRuntimeSink` and this function dispatches.
 *
 * A type no native factory claims resolves to `null` and does nothing. In practice
 * that is unreachable from the export path — the chain calls this only for a
 * device it has already built, and building requires a factory to have matched —
 * but the parameter is a bare `string` off the project, so the resolution is done
 * rather than assumed.
 */
export async function prepareOfflineDeviceSetup(input: PrepareOfflineDeviceSetupInput): Promise<void> {
    const deviceType = resolveNativeDspDeviceType(input.deviceType);
    if (!deviceType) {
        return;
    }

    const hydrate = OFFLINE_DEVICE_HYDRATION[deviceType];
    if (!hydrate) {
        return;
    }

    await hydrate(input);
}
