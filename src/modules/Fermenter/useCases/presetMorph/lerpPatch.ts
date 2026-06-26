import { type FermenterPatch } from '../../models/FermenterPatch';

const DISCRETE_PATCH_KEYS = new Set<keyof FermenterPatch>([
    'activeLayer',
    'audioModTarget',
    'filterMode',
    'filterModel',
    'fmAlgorithm',
    'lfoShape',
    'noiseColor',
    'numLayers',
    'oscEngine',
    'oscWaveform',
    'portamentoMode',
    'reverbType',
    'samplerMode',
    'warpMode',
]);

function discreteValue({ leftValue, rightValue, t }: { leftValue: number; rightValue: number; t: number }): number {
    return t < 0.5 ? leftValue : rightValue;
}

/**
 * Linearly interpolate between two patches.
 * Non-numeric fields (name, version) come from patch A.
 * Continuous numeric fields are lerped by t (0=A, 1=B).
 * Discrete numeric selectors choose the nearest source patch.
 */
export function lerpPatch(a: FermenterPatch, b: FermenterPatch, t: number): FermenterPatch {
    const clamped = Math.max(0, Math.min(1, t));
    const result = { ...a };

    for (const key of Object.keys(a) as Array<keyof FermenterPatch>) {
        const va = a[key];
        const vb = b[key];
        if (typeof va === 'number' && typeof vb === 'number') {
            if (DISCRETE_PATCH_KEYS.has(key)) {
                (result as Record<string, unknown>)[key] = discreteValue({
                    leftValue: va,
                    rightValue: vb,
                    t: clamped,
                });
                continue;
            }
            (result as Record<string, unknown>)[key] = va + (vb - va) * clamped;
        } else if (Array.isArray(va) && Array.isArray(vb) && va.length === vb.length) {
            // Assume number array (e.g. macros)
            const arr = Array.from({ length: va.length });
            for (let i = 0; i < va.length; i++) {
                const aVal = va[i];
                const bVal = vb[i];
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    arr[i] = aVal + (bVal - aVal) * clamped;
                } else {
                    arr[i] = aVal; // Fallback to A if not numbers
                }
            }
            (result as Record<string, unknown>)[key] = arr;
        }
    }

    result.name = clamped < 0.5 ? a.name : b.name;
    return result;
}
