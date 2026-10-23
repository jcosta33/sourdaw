import { digest } from '#/utils/canonicalDigest';

/**
 * The generated gain-envelope seam point's id for one half of a clip split.
 * The digest marks the id as generator-minted (`canonicalDigest` is the shared
 * identity home): an authored point id is an arbitrary string, and the bare
 * key (`gep-split-${rightClipId}-left`) is exactly the shape a musician could
 * author, which let a valid source project produce a fragment envelope
 * holding one id twice (#5287). The derivation stays a pure function of the
 * right clip id and the side, so a redo re-split reproduces exactly the point
 * the original split's undo retired.
 */
export function gainSeamPointId(rightClipId: string, side: 'left' | 'right'): string {
    const seamKey = `gep-split-${rightClipId}-${side}`;
    return `${seamKey}-${digest(seamKey).slice(0, 8)}`;
}
