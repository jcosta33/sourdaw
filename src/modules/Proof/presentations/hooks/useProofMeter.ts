import { useStoreSelector } from '#/infra/store/useStoreSelector';

import { proofStore, DEFAULT_PROOF_STATE, type ProofState } from '../../stores/proofStore';

/**
 * Subscribe a single leaf to a single metering value of one device.
 *
 * The meter sink publishes a new instances record roughly every 16 ms. A
 * component that subscribes to the whole record therefore re-renders on every
 * frame of every open device — which, when the subscriber is the panel root,
 * means the entire mastering desk re-renders about 62 times a second while the
 * user is holding a knob. Meter values are read here, at the component that
 * actually displays them, so a meter frame reaches the readouts and nothing
 * else.
 *
 * `isEqual` exists for selections that are not primitives: the engine hands the
 * store fresh `dynGr`/`tapPeaks` arrays per frame, so identity comparison would
 * report a change on every frame even when the numbers are unchanged.
 *
 * The fallback is the module default state rather than a fresh one per call:
 * a new object per call is a new selection every frame, and this hook only ever
 * reads.
 */
export function useProofMeter<TSelected>(
    deviceId: string,
    selectMeter: (state: ProofState) => TSelected,
    isEqual?: (a: TSelected, b: TSelected) => boolean
): TSelected {
    return useStoreSelector(
        proofStore,
        (instances) => selectMeter(instances?.[deviceId] ?? DEFAULT_PROOF_STATE),
        isEqual
    );
}
