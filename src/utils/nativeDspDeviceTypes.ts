/**
 * The canonical set of native-DSP device types, and the union derived from it.
 *
 * These live outside `src/modules` for the same reason as the matchers in
 * `deviceTypeMatching.ts`: two places have to agree on them exactly and the
 * module graph gives them no shared contract barrel. The offline factory list
 * (`AudioEngine/repositories/deviceStrategy/nativeDspDeviceFactories.ts`) decides
 * which types can be *built*; the composition root decides which types must be
 * *hydrated*. A contract barrel cannot carry the vocabulary between them —
 * `no-models-repos-transformers-in-index` forbids a barrel re-exporting anything
 * under `repositories/`, so there is no legal route from the factory list to
 * `src/app/`. One copy here, imported by both, is what keeps them welded.
 *
 * Keeping them welded is the point. The two sides have drifted before: a
 * `grand-boule` branch existed in the strategy factory while the matcher list
 * omitted it, so no factory claimed the type, `createDevice` threw, and a frozen
 * or bounced GrandBoule track rendered silence while live playback was fine.
 *
 * Adding a native device means adding it here, which makes the hydration table in
 * `src/app/prepareOfflineDeviceSetup.ts` fail to compile until someone decides
 * whether that device needs hydration. That compile failure is the whole purpose
 * of this file: it converts "a device renders wrong and someone eventually hears
 * it" into "the build stops".
 */
export const NATIVE_DSP_DEVICE_TYPES = [
    'fermenter',
    'toaster',
    'levain',
    // The sampler/slicer. The only native type carrying the `builtin-` prefix,
    // which is why `createDeviceRegistry` has to exclude native ids from its
    // `builtin-` WebAudio arm — that arm is a prefix match registered first, and
    // it would otherwise claim Crumbs and refuse to build it.
    'builtin-crumbs',
    'grand-boule',
    'gluten',
    'crust',
    'bacteria',
    'grinder',
    'proof',
    // The ProofChamber reverb ships under its bakery name in device ids.
    'dutch-oven',
    // The Tuner, whose engine is the `scoring` crate.
    'native-scoring',
    'knead',
] as const;

export type NativeDspDeviceType = (typeof NATIVE_DSP_DEVICE_TYPES)[number];

/**
 * Resolve a project's raw device-type string to its canonical native-DSP type,
 * or `null` when no native factory claims it.
 *
 * This mirrors the factory matchers rather than reimplementing them, and
 * `nativeDspDeviceFactories.spec.ts` pins the two together: every factory's
 * declared type must be one its own `matches` accepts, and this resolver must
 * agree with `isNativeDspDevice` on every canonical type.
 *
 * **The `knead` arm is not a typo.** `isKneadDevice` is the only matcher in the
 * set that case-folds (`deviceType.toLowerCase() === 'knead'`); the other ten are
 * exact equality. That asymmetry looks accidental, but it is live behaviour: a
 * project carrying `Knead` builds today. Reproducing it here keeps this resolver
 * faithful to what actually gets built. Do not "tidy" it into exact equality
 * without also changing the matcher, and do not case-fold the other ten to match
 * — that would make types build that currently do not.
 */
export function resolveNativeDspDeviceType(deviceType: string): NativeDspDeviceType | null {
    for (const candidate of NATIVE_DSP_DEVICE_TYPES) {
        if (deviceType === candidate) {
            return candidate;
        }
    }

    if (deviceType.toLowerCase() === 'knead') {
        return 'knead';
    }

    return null;
}
