/**
 * Proof mastering suite — parameter definitions and defaults.
 */

export type ProofModuleId = 'eq' | 'dynamics' | 'imager' | 'exciter' | 'limiter';

export type ProofTarget = 'streaming' | 'cd' | 'club' | 'broadcast' | 'podcast' | 'custom';

export type ProofStyle = 'warm' | 'clean' | 'loud' | 'balanced' | 'vintage';

export type DitherMode = 'off' | 'tpdf' | 'noise_shaped';

export type SaturationType = 'tape' | 'tube' | 'transistor' | 'warm';

export type EqBandChannel = 'stereo' | 'mid' | 'side';

export type ProofPatch = {
    name: string;

    /**
     * Identity of the factory preset this patch was loaded from, or `undefined`
     * once the patch has diverged through any granular edit. Used solely for
     * "active preset" detection in the UI — `name` is a display label and is
     * not a stable preset identity (multiple edits keep the same name). Project
     * reload reconstructs this identity only when every saved value still
     * exactly matches a factory preset.
     */
    presetId?: string;

    // Chain order (module IDs 0-4)
    chainOrder: [number, number, number, number, number];

    // Input/Output
    inputGain: number; // dB
    outputGain: number; // dB

    // EQ
    eqBypassed: boolean;
    eqBands: Array<{
        enabled: boolean;
        type: number; // 0=peak, 1=lowShelf, 2=highShelf, 3=highPass, 4=lowPass
        channel: number; // 0=stereo, 1=mid, 2=side
        freq: number;
        gain: number; // dB
        q: number;
    }>;

    // Multiband Dynamics
    dynBypassed: boolean;
    dynCrossoverFreqs: [number, number, number]; // 3 crossover points for 4 bands
    dynBands: Array<{
        threshold: number;
        ratio: number;
        attack: number; // ms
        release: number; // ms
        knee: number; // dB
        makeup: number; // dB
        autoMakeup: boolean;
        bypassed: boolean;
    }>;

    // Stereo Imager
    imgBypassed: boolean;
    imgBandWidth: [number, number, number, number]; // per-band width 0-2
    imgAutoMonoBass: boolean;
    imgMonoBassFreq: number; // Hz

    // Exciter
    excBypassed: boolean;
    excBands: Array<{
        type: number; // 0=tape, 1=tube, 2=transistor, 3=warm
        drive: number; // 0-1
        blend: number; // 0-1
        enabled: boolean;
    }>;

    // Limiter
    limBypassed: boolean;
    limCeiling: number; // dB (-12 to 0)
    limRelease: number; // ms
    limLookahead: number; // ms

    // Dither
    ditherMode: DitherMode;
    ditherBits: number;

    // Target
    target: ProofTarget;
    targetLufs: number;
};

/**
 * Copy a patch down to every band object, so no two patches ever share a
 * mutable array or band identity.
 *
 * `DEFAULT_PATCH` and the factory presets are module singletons. A shallow
 * spread carries `eqBands`/`dynBands`/`excBands`/`chainOrder`/
 * `dynCrossoverFreqs`/`imgBandWidth` by reference, so the module default, every
 * preset and every live device end up pointing at one array. The first in-place
 * `band.gain = x` anywhere then rewrites the factory defaults and every open
 * device at once, with no way back short of an app restart. Every constructor
 * of a live patch clones instead.
 */
export function cloneProofPatch(patch: ProofPatch): ProofPatch {
    return {
        ...patch,
        chainOrder: [...patch.chainOrder],
        eqBands: patch.eqBands.map((band) => ({ ...band })),
        dynCrossoverFreqs: [...patch.dynCrossoverFreqs],
        dynBands: patch.dynBands.map((band) => ({ ...band })),
        imgBandWidth: [...patch.imgBandWidth],
        excBands: patch.excBands.map((band) => ({ ...band })),
    };
}

// Canonicalize patch values so gesture ownership survives new object/array instances.
export function getProofPatchSnapshot(patch: ProofPatch): string {
    return JSON.stringify([
        patch.name,
        patch.presetId ?? null,
        patch.chainOrder,
        patch.inputGain,
        patch.outputGain,
        patch.eqBypassed,
        patch.eqBands.map((band) => [band.enabled, band.type, band.channel, band.freq, band.gain, band.q]),
        patch.dynBypassed,
        patch.dynCrossoverFreqs,
        patch.dynBands.map((band) => [
            band.threshold,
            band.ratio,
            band.attack,
            band.release,
            band.knee,
            band.makeup,
            band.autoMakeup,
            band.bypassed,
        ]),
        patch.imgBypassed,
        patch.imgBandWidth,
        patch.imgAutoMonoBass,
        patch.imgMonoBassFreq,
        patch.excBypassed,
        patch.excBands.map((band) => [band.type, band.drive, band.blend, band.enabled]),
        patch.limBypassed,
        patch.limCeiling,
        patch.limRelease,
        patch.limLookahead,
        patch.ditherMode,
        patch.ditherBits,
        patch.target,
        patch.targetLufs,
    ]);
}

type ScalarProofPatchKey = Exclude<
    keyof ProofPatch,
    | 'name'
    | 'presetId'
    | 'eqBands'
    | 'dynCrossoverFreqs'
    | 'dynBands'
    | 'imgBandWidth'
    | 'excBands'
    | 'target'
    | 'targetLufs'
>;

type ScalarProofPatchEdit = {
    [Key in ScalarProofPatchKey]-?: {
        key: Key;
        value: ProofPatch[Key];
        isTransient?: boolean;
    };
}[ScalarProofPatchKey];

export type ProofPatchEdit =
    | ScalarProofPatchEdit
    | {
          key: 'eqBands';
          value: ProofPatch['eqBands'];
          changedParams?: readonly {
              bandIndex: number;
              field: keyof ProofPatch['eqBands'][number];
          }[];
          isTransient?: boolean;
      }
    | {
          key: 'dynCrossoverFreqs';
          value: ProofPatch['dynCrossoverFreqs'];
          changedParams?: readonly { crossoverIndex: number }[];
          isTransient?: boolean;
      }
    | {
          key: 'dynBands';
          value: ProofPatch['dynBands'];
          changedParams?: readonly {
              bandIndex: number;
              field: keyof ProofPatch['dynBands'][number];
          }[];
          isTransient?: boolean;
      }
    | {
          key: 'imgBandWidth';
          value: ProofPatch['imgBandWidth'];
          changedParams?: readonly { bandIndex: number }[];
          isTransient?: boolean;
      }
    | {
          key: 'excBands';
          value: ProofPatch['excBands'];
          changedParams?: readonly {
              bandIndex: number;
              field: keyof ProofPatch['excBands'][number];
          }[];
          isTransient?: boolean;
      };

export const PROOF_PATCH_RANGES = {
    inputGain: [-24, 24],
    outputGain: [-24, 24],
    eqBand: {
        freq: [20, 20_000],
        gain: [-18, 18],
        q: [0.1, 10],
        type: [0, 4],
        channel: [0, 2],
    },
    dynCrossoverFreq: [20, 20_000],
    dynBand: {
        threshold: [-60, 0],
        ratio: [1, 20],
        attack: [1, 200],
        release: [10, 2_000],
        knee: [0, 12],
        makeup: [-12, 24],
    },
    imgBandWidth: [0, 2],
    imgMonoBassFreq: [40, 200],
    excBand: {
        type: [0, 3],
        drive: [0, 1],
        blend: [0, 1],
    },
    limCeiling: [-12, 0],
    limRelease: [10, 500],
    limLookahead: [0.5, 10],
    ditherBits: [16, 24],
    targetLufs: [-60, 0],
    chainModuleId: [0, 4],
} as const;

export const DEFAULT_PATCH: ProofPatch = {
    name: 'Init',
    chainOrder: [0, 1, 2, 3, 4],
    inputGain: 0,
    outputGain: 0,

    eqBypassed: false,
    eqBands: [
        { enabled: false, type: 3, channel: 0, freq: 30, gain: 0, q: 0.707 },
        { enabled: true, type: 1, channel: 0, freq: 80, gain: 0, q: 0.707 },
        { enabled: true, type: 0, channel: 0, freq: 250, gain: 0, q: 1.0 },
        { enabled: true, type: 0, channel: 0, freq: 800, gain: 0, q: 1.0 },
        { enabled: true, type: 0, channel: 0, freq: 2500, gain: 0, q: 1.0 },
        { enabled: true, type: 0, channel: 0, freq: 6000, gain: 0, q: 1.0 },
        { enabled: true, type: 2, channel: 0, freq: 12000, gain: 0, q: 0.707 },
        { enabled: false, type: 4, channel: 0, freq: 18000, gain: 0, q: 0.707 },
    ],

    dynBypassed: false,
    dynCrossoverFreqs: [120, 1000, 8000],
    dynBands: [
        { threshold: -20, ratio: 2, attack: 10, release: 100, knee: 6, makeup: 0, autoMakeup: true, bypassed: false },
        { threshold: -18, ratio: 2, attack: 10, release: 100, knee: 6, makeup: 0, autoMakeup: true, bypassed: false },
        { threshold: -16, ratio: 1.5, attack: 5, release: 80, knee: 6, makeup: 0, autoMakeup: true, bypassed: false },
        { threshold: -14, ratio: 1.5, attack: 3, release: 60, knee: 6, makeup: 0, autoMakeup: true, bypassed: false },
    ],

    imgBypassed: false,
    imgBandWidth: [0.0, 0.8, 1.0, 1.3],
    imgAutoMonoBass: true,
    imgMonoBassFreq: 80,

    excBypassed: true,
    excBands: [
        { type: 0, drive: 0.2, blend: 0.3, enabled: false },
        { type: 0, drive: 0.2, blend: 0.3, enabled: false },
        { type: 0, drive: 0.2, blend: 0.3, enabled: false },
        { type: 0, drive: 0.3, blend: 0.4, enabled: false },
    ],

    limBypassed: false,
    limCeiling: -1.0,
    limRelease: 100,
    limLookahead: 5,

    ditherMode: 'off',
    ditherBits: 16,

    target: 'streaming',
    targetLufs: -14,
};

/** Display name of each delivery target. One source for chips, readouts and alert copy. */
export const TARGET_LABELS: Record<ProofTarget, string> = {
    streaming: 'Streaming',
    cd: 'CD',
    club: 'Club / DJ',
    broadcast: 'Broadcast',
    podcast: 'Podcast',
    custom: 'custom',
};

export const TARGET_LUFS: Record<ProofTarget, number> = {
    streaming: -14,
    cd: -9,
    club: -6,
    broadcast: -23,
    podcast: -16,
    custom: -14,
};
