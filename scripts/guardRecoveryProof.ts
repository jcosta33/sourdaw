import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const GUARD_RECOVERY_PROOF_PATH_ENV = 'SOURDAW_GUARD_RECOVERY_PROOF_PATH';
export const GUARD_RECOVERY_PROOF_TOKEN_ENV = 'SOURDAW_GUARD_RECOVERY_PROOF_TOKEN';
export const GUARD_RECOVERY_PROOF_ORIGIN_ENV = 'SOURDAW_GUARD_RECOVERY_PROOF_ORIGIN';

export type GuardRecoveryProofExpectation = {
    token: string;
    origin: string;
    expectedRoot: string;
};

type GuardRecoveryProof = GuardRecoveryProofExpectation & {
    version: 1;
    servingRoot: string;
};

function comparableRoot(root: string): string {
    try {
        return realpathSync(root);
    } catch {
        return resolve(root);
    }
}

export function sameCheckoutRoot(left: string, right: string): boolean {
    return comparableRoot(left) === comparableRoot(right);
}

export function writeGuardRecoveryProof(
    env: NodeJS.ProcessEnv,
    origin: string,
    servingRoot: string | null,
    expectedRoot: string
): void {
    const path = env[GUARD_RECOVERY_PROOF_PATH_ENV];
    const token = env[GUARD_RECOVERY_PROOF_TOKEN_ENV];
    const recordedOrigin = env[GUARD_RECOVERY_PROOF_ORIGIN_ENV];
    if (path === undefined && token === undefined && recordedOrigin === undefined) {
        return;
    }
    if (path === undefined || token === undefined || recordedOrigin === undefined) {
        throw new Error('guard recovery proof requires its path, token and recorded origin');
    }
    if (origin !== recordedOrigin) {
        return;
    }
    if (servingRoot === null) {
        throw new Error(`guard recovery requires an e2e checkout marker from ${origin}`);
    }
    if (!sameCheckoutRoot(servingRoot, expectedRoot)) {
        throw new Error(`guard recovery server at ${origin} does not belong to ${expectedRoot}`);
    }
    const proof: GuardRecoveryProof = { version: 1, token, origin, servingRoot, expectedRoot };
    writeFileSync(path, JSON.stringify(proof), { flag: 'wx' });
}

export function assertGuardRecoveryProof(path: string, expectation: GuardRecoveryProofExpectation): void {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
        throw new Error('the guard-verified server proof is missing or unreadable');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('the guard-verified server proof is malformed');
    }
    const proof = parsed as Partial<GuardRecoveryProof>;
    if (
        proof.version !== 1 ||
        proof.token !== expectation.token ||
        proof.origin !== expectation.origin ||
        typeof proof.servingRoot !== 'string' ||
        typeof proof.expectedRoot !== 'string' ||
        !sameCheckoutRoot(proof.servingRoot, expectation.expectedRoot) ||
        !sameCheckoutRoot(proof.expectedRoot, expectation.expectedRoot)
    ) {
        throw new Error('the guard-verified server proof does not match the recorded server and checkout');
    }
}
