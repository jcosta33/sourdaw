import { PROOF_PATCH_RANGES, TARGET_LUFS, type ProofPatch, type ProofTarget } from '../models/ProofPatch';

const PROOF_TARGETS: readonly ProofTarget[] = ['streaming', 'cd', 'club', 'broadcast', 'podcast', 'custom'];

export function proofTargetToInt(target: ProofTarget): number {
    return PROOF_TARGETS.indexOf(target);
}

export function proofTargetFromInt(value: number | undefined): ProofTarget | null {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        return null;
    }

    return PROOF_TARGETS[value] ?? null;
}

export function readRestoredProofTarget(
    parameterValues: Readonly<Record<string, number | null>>
): Pick<ProofPatch, 'target' | 'targetLufs'> | undefined {
    const target = proofTargetFromInt(parameterValues.target_mode ?? undefined);
    const targetLufs = parameterValues.target_lufs;
    const [min, max] = PROOF_PATCH_RANGES.targetLufs;
    if (
        target === null ||
        typeof targetLufs !== 'number' ||
        !Number.isFinite(targetLufs) ||
        targetLufs < min ||
        targetLufs > max
    ) {
        return undefined;
    }
    return target === 'custom' || targetLufs === TARGET_LUFS[target] ? { target, targetLufs } : undefined;
}
