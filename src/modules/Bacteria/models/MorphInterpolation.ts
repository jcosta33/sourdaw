/**
 * XY morph pad — bilinear interpolation between the four snapshot corners.
 *
 * Morphing is resolved here, in the UI, and its results reach the engine as
 * ordinary scalar `(paramId, value)` writes through the parameter bridge (see
 * `applyBacteriaMorphWithAudio`). The engine carries no morph state at all.
 */
import { type BacteriaSnapshot } from './BacteriaPatch';

/** The engine-keyed values one corner holds, as captured by the panel. */
type CornerValues = Readonly<Record<string, number>>;

/** Bilinear weights for corners A (0,0), B (1,0), C (0,1), D (1,1). */
export type MorphCornerWeights = readonly [number, number, number, number];

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

/**
 * The four bilinear weights at position (x, y), in corner order A/B/C/D:
 * `(1-x)(1-y)`, `x(1-y)`, `(1-x)y`, `xy`. The position is clamped into the
 * pad, so an out-of-range write lands on the nearest corner instead of
 * producing a negative weight.
 */
export function morphCornerWeights(x: number, y: number): MorphCornerWeights {
    const nx = clamp01(x);
    const ny = clamp01(y);
    return [(1 - nx) * (1 - ny), nx * (1 - ny), (1 - nx) * ny, nx * ny];
}

/**
 * The morph result at (x, y): for every parameter all four corners hold, the
 * weighted sum of the corner values.
 *
 * A parameter absent from any corner is absent from the result — a gap is not
 * zero, and treating it as one would smear a captured corner toward a value
 * the user never stored. A corner that has never been captured holds no
 * parameters, so with any corner uncaptured the pad moves nothing: the
 * shipped patch's four empty corners morph exactly nothing.
 */
export function interpolateMorphSnapshot(
    x: number,
    y: number,
    snapshots: readonly BacteriaSnapshot[]
): Record<string, number> {
    const corners: CornerValues[] = snapshots.slice(0, 4).map((snapshot) => snapshot.paramValues);
    if (corners.length < 4) {
        return {};
    }

    const weights = morphCornerWeights(x, y);
    const morphed: Record<string, number> = {};
    for (const paramId of Object.keys(corners[0]!)) {
        let value = 0;
        let held = true;
        for (let corner = 0; corner < 4; corner += 1) {
            const cornerValue = corners[corner]![paramId];
            if (cornerValue === undefined) {
                held = false;
                break;
            }
            value += weights[corner]! * cornerValue;
        }
        if (held) {
            morphed[paramId] = value;
        }
    }
    return morphed;
}
