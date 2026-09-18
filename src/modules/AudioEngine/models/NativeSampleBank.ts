/**
 * One Levain sample bank as the native side takes it, and the renderer's lease
 * on it (#3124).
 *
 * ## One vocabulary, two runtimes
 *
 * The field names are the worklet's own upload protocol:
 * `loadInstrumentFromManifest.ts` posts them at a `MessagePort` and
 * `services/levainProcessor.ts` translates them into `LevainInstance` calls.
 * `LevainZone` / `LevainLegatoTransition` / `LevainBankLayout`
 * (`crates/sourdaw-native/src/commands/levain.rs`) accept the same vocabulary
 * with `deny_unknown_fields` and translate it identically, so a strip that
 * moves between the browser runtime and the native one sounds the same bank
 * rather than a second reading of it. A field added or renamed on one side
 * alone is refused by the other.
 *
 * ## Why a model and not a repository type
 *
 * Three layers read these shapes: the transport that carries a bank
 * (`repositories/nativeGraph/nativeGraphTransport.ts`), the registration that
 * stages one ahead of a graph batch (`registerNativeSampleBanks.ts`), and the
 * runtime sink the composition root answers a renderer-side lease through
 * (`engine/audioDeviceRuntimeSink.ts`). A model is the one place all three may
 * import from.
 */

/**
 * One zone of a committed bank, in the same vocabulary the worklet's `addZone`
 * message carries.
 *
 * `zoneId` is absent because the array's order is the numbering, on both sides:
 * `loadInstrumentFromManifest.ts` increments a local counter as it posts, and
 * `LevainZone` deliberately omits the field so a second copy of the numbering
 * cannot disagree with itself.
 */
export type NativeLevainZone = Readonly<{
    sampleId: string;
    articulationId: number;
    rootNote: number;
    tuneCents?: number;
    loKey: number;
    hiKey: number;
    loVel: number;
    hiVel: number;
    rrPos: number;
    rrLen: number;
    micId: number;
    isRelease: boolean;
    loopMode: 'none' | 'forward' | 'pingpong';
    loopStart: number;
    loopEnd: number;
    loopCrossfade: number;
    gainDb: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
}>;

/** One recorded true-legato transition, in the worklet's own vocabulary. */
export type NativeLevainLegatoTransition = Readonly<{
    sampleId: string;
    interval: number;
    transitionType: string;
    dynamic: string;
    crossfadeOutMs: number;
}>;

/**
 * What closes a staged bank: the zone map to build and the dimensions to build
 * it at. The hand-maintained mirror of `LevainBankLayout`
 * (`crates/sourdaw-native/src/commands/levain.rs`), which refuses a field it
 * does not know.
 */
export type NativeLevainBankLayout = Readonly<{
    zones: readonly NativeLevainZone[];
    legatoTransitions: readonly NativeLevainLegatoTransition[];
    numArticulations: number;
    numMics: number;
}>;

/** One decoded file of a bank, as `register_levain_sample` takes it. */
export type NativeSampleBankSample = Readonly<{
    /** The renderer's own id for this file, which the layout's zones name. */
    sampleId: string;
    /** The material's own rate; the native side converts at build time. */
    sampleRate: number;
    channels: 1 | 2;
    /** Frames per channel, which `pcm` must carry exactly. */
    frameCount: number;
    /**
     * Interleaved f32 little-endian, in a buffer the bridge may take: never a
     * `SharedArrayBuffer`-backed view, which the structured-clone path across
     * the desktop bridge cannot carry.
     */
    pcm: Uint8Array;
}>;

/**
 * A whole bank ready to stage: its dimensions and zone map, plus the material
 * those zones name.
 *
 * The layout fields sit flat rather than nested because they are the bank's own
 * dimensions, not a sub-document; `registerNativeSampleBanks` rebuilds the
 * narrower `NativeLevainBankLayout` for the commit, because that command's
 * payload is deserialized with `deny_unknown_fields` and would refuse
 * `instrumentId` or `samples` travelling beside it.
 */
export type NativeSampleBank = NativeLevainBankLayout &
    Readonly<{
        instrumentId: string;
        samples: readonly NativeSampleBankSample[];
    }>;

/**
 * A bank plus the renderer-side lease that keeps its decoded PCM alive.
 *
 * The decoded-bank cache is reference counted, so the material this bank's
 * `pcm` was copied out of stands only until `release` is called. Registration
 * calls it as soon as the bytes have crossed the bridge — the native store
 * holds its own copy from then on — and the bank's life on the native side is
 * ended by `release_levain_bank` instead, which is a separate decision from
 * this lease.
 */
export type NativeSampleBankLease = Readonly<{
    bank: NativeSampleBank;
    release: () => void;
}>;
