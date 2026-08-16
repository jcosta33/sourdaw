/**
 * Proof mastering suite factory presets.
 */
import { type ProofPatch, DEFAULT_PATCH, cloneProofPatch } from '../models/ProofPatch';

export type ProofPreset = {
    id: string;
    name: string;
    category: string;
    patch: ProofPatch;
};

// Cloned so no preset shares a band array with `DEFAULT_PATCH` or with another
// preset: an override names some arrays, and the ones it leaves out would
// otherwise be the module default's own.
function preset(id: string, name: string, category: string, overrides: Partial<ProofPatch>): ProofPreset {
    return { id, name, category, patch: cloneProofPatch({ ...DEFAULT_PATCH, ...overrides, name, presetId: id }) };
}

export const PROOF_PRESETS: readonly ProofPreset[] = [
    // ── Target-based ──
    preset('streaming', 'Streaming Master', 'target', {
        target: 'streaming',
        targetLufs: -14,
        limCeiling: -1.0,
        eqBands: DEFAULT_PATCH.eqBands.map((b, i) =>
            (() => {
                if (i === 1) {
                    return { ...b, gain: 1.5 };
                }
                if (i === 6) {
                    return { ...b, gain: 1.0 };
                }
                return b;
            })()
        ),
    }),
    preset('cd-master', 'CD Master', 'target', {
        target: 'cd',
        targetLufs: -9,
        limCeiling: -0.1,
        dynBands: DEFAULT_PATCH.dynBands.map((b) => ({ ...b, threshold: -15, ratio: 3 })),
    }),
    preset('club', 'Club / DJ', 'target', {
        target: 'club',
        targetLufs: -6,
        limCeiling: -0.5,
        dynBands: DEFAULT_PATCH.dynBands.map((b) => ({ ...b, threshold: -12, ratio: 4, attack: 5 })),
    }),
    preset('broadcast', 'Broadcast (EBU R128)', 'target', {
        target: 'broadcast',
        targetLufs: -23,
        limCeiling: -1.0,
    }),
    preset('podcast', 'Podcast', 'target', {
        target: 'podcast',
        targetLufs: -16,
        limCeiling: -1.0,
        imgBandWidth: [0.0, 0.5, 0.7, 0.7], // narrower stereo
    }),

    // ── Style-based ──
    preset('warm', 'Warm Master', 'style', {
        eqBands: DEFAULT_PATCH.eqBands.map((b, i) =>
            (() => {
                if (i === 1) {
                    return { ...b, gain: 2.0 };
                }
                if (i === 6) {
                    return { ...b, gain: 1.5 };
                }
                return b;
            })()
        ),
        excBypassed: false,
        excBands: [
            { type: 0, drive: 0.3, blend: 0.4, enabled: true }, // tape on low
            { type: 0, drive: 0.2, blend: 0.3, enabled: true }, // tape on low-mid
            { type: 0, drive: 0.15, blend: 0.2, enabled: false }, // off on high-mid
            { type: 3, drive: 0.1, blend: 0.2, enabled: true }, // warm on high
        ],
    }),
    preset('clean', 'Clean & Transparent', 'style', {
        eqBypassed: true,
        excBypassed: true,
        dynBands: DEFAULT_PATCH.dynBands.map((b) => ({ ...b, ratio: 1.5, knee: 10 })),
    }),
    preset('loud', 'Loud & Present', 'style', {
        target: 'cd',
        targetLufs: -9,
        limCeiling: -0.3,
        dynBands: DEFAULT_PATCH.dynBands.map((b) => ({ ...b, threshold: -16, ratio: 3, attack: 5 })),
        eqBands: DEFAULT_PATCH.eqBands.map(
            (b, i) => (i === 4 ? { ...b, gain: 2.0 } : b) // presence boost at 2.5kHz
        ),
    }),
    preset('vintage', 'Vintage Tape', 'style', {
        excBypassed: false,
        excBands: [
            { type: 0, drive: 0.4, blend: 0.5, enabled: true },
            { type: 0, drive: 0.3, blend: 0.4, enabled: true },
            { type: 1, drive: 0.2, blend: 0.3, enabled: true }, // tube on high-mid
            { type: 0, drive: 0.2, blend: 0.3, enabled: true },
        ],
        dynBands: DEFAULT_PATCH.dynBands.map((b) => ({ ...b, ratio: 2, attack: 20, release: 200 })),
    }),

    // ── Genre-based ──
    preset('edm', 'EDM / Club', 'genre', {
        target: 'club',
        targetLufs: -6,
        limCeiling: -0.5,
        eqBands: DEFAULT_PATCH.eqBands.map((b, i) =>
            (() => {
                if (i === 1) {
                    return { ...b, gain: 3.0 };
                }
                if (i === 4) {
                    return { ...b, gain: 2.0 };
                }
                return b;
            })()
        ),
        imgBandWidth: [0.0, 1.0, 1.3, 1.5],
    }),
    preset('hiphop', 'Hip-Hop / R&B', 'genre', {
        eqBands: DEFAULT_PATCH.eqBands.map((b, i) =>
            (() => {
                if (i === 1) {
                    return { ...b, gain: 3.5 };
                }
                if (i === 4) {
                    return { ...b, gain: 1.5 };
                }
                return b;
            })()
        ),
        dynBands: DEFAULT_PATCH.dynBands.map((b, i) => (i === 0 ? { ...b, threshold: -18, ratio: 3, attack: 5 } : b)),
    }),
    preset('classical', 'Classical / Acoustic', 'genre', {
        eqBypassed: true,
        excBypassed: true,
        dynBands: DEFAULT_PATCH.dynBands.map((b) => ({ ...b, ratio: 1.2, knee: 12 })),
        limCeiling: -1.0,
        ditherMode: 'tpdf',
        ditherBits: 24,
    }),
];
