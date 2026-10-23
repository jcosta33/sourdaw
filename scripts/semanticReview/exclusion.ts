/**
 * The content-free path screen the collector runs before any read: which changed paths contribute no
 * evidence at all, and why, so an excluded path stays visible in the scope manifest rather than
 * vanishing from the report.
 */

import { compareLexicographic } from './pathOrder.ts';
import { applicableRules, isCollectedSpec } from './rules.ts';

export type SemanticChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export type SemanticChangedFile = {
    /** The post-change path; for a deletion, the path that was removed. */
    readonly path: string;
    /** The pre-change path when the change is a rename. */
    readonly previousPath?: string;
    readonly kind: SemanticChangeKind;
    readonly binary: boolean;
    readonly generated: boolean;
    readonly added: number;
    readonly deleted: number;
};

/**
 * Paths whose content must not leave the machine. Secret scanning is defense in depth, not a
 * guarantee that arbitrary source has been sanitized, so a relevant exclusion is recorded as
 * incomplete context rather than silently dropped.
 */
const SENSITIVE_PATH_PATTERNS: readonly RegExp[] = [
    /(?:^|\/)\.env(?:\.|$)/u,
    /(?:^|\/)\.env\.sourdaw/u,
    /\.(?:pem|key|p12|pfx|keystore)$/iu,
    /(?:^|\/)id_(?:rsa|ed25519|ecdsa)$/u,
    /(?:^|\/)\.ssh\//u,
    /(?:^|\/)\.aws\//u,
    /(?:^|\/)\.npmrc$/u,
    /(?:^|\/)\.netrc$/u,
    /(?:^|\/)credentials(?:\.|$)/iu,
    /(?:^|\/)\.agents\/artifacts\//u,
    /(?:^|\/)transcripts?\//iu,
];

const LOCKFILE_NAMES: ReadonlySet<string> = new Set(['Cargo.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);

export function isSensitivePath(path: string): boolean {
    return SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function baseName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1] ?? path;
}

/** The rule ids a path admits, sorted so two sets can be compared for equality. */
function ruleIdsFor(path: string): string[] {
    return applicableRules([path])
        .map((rule) => rule.id)
        .sort(compareLexicographic);
}

/** Whether two paths admit different rule sets, so a rename between them still owes an assessment. */
function ruleSetsDiffer(left: string, right: string): boolean {
    const leftIds = ruleIdsFor(left);
    const rightIds = ruleIdsFor(right);
    return leftIds.length !== rightIds.length || leftIds.some((id, index) => id !== rightIds[index]);
}

/**
 * Why a changed path contributes no evidence. Each reason is recorded in the scope manifest, so an
 * excluded path stays visible rather than vanishing from the report.
 */
export function exclusionReason(file: SemanticChangedFile): string | undefined {
    if (isSensitivePath(file.path) || (file.previousPath !== undefined && isSensitivePath(file.previousPath))) {
        return 'sensitive-content-excluded';
    }
    if (file.binary) {
        return 'binary';
    }
    if (file.generated) {
        return 'generated';
    }
    if (LOCKFILE_NAMES.has(baseName(file.path))) {
        return 'dependency-lockfile';
    }
    if (file.added === 0 && file.deleted === 0) {
        // A pure rename has a zero-line diff, but a rename can still be a semantic change: it can move
        // a file out of a rule-covered surface, or stop a runner collecting it as a test. Calling every
        // such rename `no-text-change` excluded the path, and the skipped branch then read the change as
        // delivered advice over the very movement the rename performed. A rename that changes neither
        // the applicable rule set nor collection owes nothing. An exact copy shares the same zero-line
        // numstat but is not exempt: it adds a path to the tree, and `duplicates_existing_mechanism`
        // exists precisely to question a newly duplicated mechanism.
        if (file.kind === 'copied') {
            return undefined;
        }
        if (file.kind === 'renamed' && file.previousPath !== undefined) {
            const collectionChanged = isCollectedSpec(file.previousPath) !== isCollectedSpec(file.path);
            if (collectionChanged || ruleSetsDiffer(file.previousPath, file.path)) {
                return undefined;
            }
        }
        return 'no-text-change';
    }
    return undefined;
}
