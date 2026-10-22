/**
 * The reviewer App's `CI_APPROVAL_LABEL` writes for `review:publish`. A `labeled` event of this label
 * is what approval-gated CI admits, and only for the reviewer App's approval of the exact head.
 */
import { CI_APPROVAL_LABEL, REQUIRED_REPOSITORY } from './githubAppIdentity.ts';

export type GhCall = (args: string[], input?: string) => string;

const APPROVAL_LABEL_PATH = encodeURIComponent(CI_APPROVAL_LABEL);

function isNotFound(error: unknown): boolean {
    return error instanceof Error && /\bHTTP 404\b/u.test(error.message);
}

function ensureApprovalLabelExists(gh: GhCall): void {
    try {
        gh(['api', `repos/${REQUIRED_REPOSITORY}/labels/${APPROVAL_LABEL_PATH}`]);
        return;
    } catch (error) {
        if (!isNotFound(error)) {
            throw error;
        }
    }
    gh(
        ['api', '--method', 'POST', `repos/${REQUIRED_REPOSITORY}/labels`, '--input', '-'],
        JSON.stringify({
            name: CI_APPROVAL_LABEL,
            color: '0e8a16',
            description: 'The reviewer App approved this exact head',
        })
    );
}

/** Takes the label off the pull request, succeeding when it was not applied. */
export function removeApprovalLabel(gh: GhCall, number: number): void {
    try {
        gh([
            'api',
            '--method',
            'DELETE',
            `repos/${REQUIRED_REPOSITORY}/issues/${number}/labels/${APPROVAL_LABEL_PATH}`,
        ]);
    } catch (error) {
        if (!isNotFound(error)) {
            throw error;
        }
    }
}

/**
 * GitHub emits `labeled` only when a label is newly added, so a label left on the pull request by an
 * earlier head comes off first: every approval must start its own run.
 */
export function applyApprovalLabel(gh: GhCall, number: number): void {
    ensureApprovalLabelExists(gh);
    removeApprovalLabel(gh, number);
    gh(
        ['api', '--method', 'POST', `repos/${REQUIRED_REPOSITORY}/issues/${number}/labels`, '--input', '-'],
        JSON.stringify({ labels: [CI_APPROVAL_LABEL] })
    );
}
