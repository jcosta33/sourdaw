import { type ProofTarget } from '../models/ProofPatch';

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
