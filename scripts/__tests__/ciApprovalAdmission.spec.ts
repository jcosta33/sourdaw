import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { admissionOutputLine, decideApprovalAdmission, type ApprovalAdmissionInput } from '../ciApprovalAdmission.ts';
import { AUTHOR_BOT_NODE_ID, CI_APPROVAL_LABEL, REVIEWER_BOT_NODE_ID } from '../githubAppIdentity.ts';

const HEAD = 'a'.repeat(40);
const OLDER_HEAD = 'b'.repeat(40);

function review(state: string, commitId = HEAD, nodeId = REVIEWER_BOT_NODE_ID): Record<string, unknown> {
    return { id: 1, state, commit_id: commitId, user: { node_id: nodeId, login: 'reviewer[bot]' } };
}

function input(overrides: Partial<ApprovalAdmissionInput> = {}): ApprovalAdmissionInput {
    return {
        reviews: [review('APPROVED')],
        headSha: HEAD,
        labelName: CI_APPROVAL_LABEL,
        senderNodeId: REVIEWER_BOT_NODE_ID,
        reviewerNodeId: REVIEWER_BOT_NODE_ID,
        approvalLabel: CI_APPROVAL_LABEL,
        ...overrides,
    };
}

describe('approval admission', () => {
    it('admits the reviewer App approval label for an approved exact head', () => {
        expect(decideApprovalAdmission(input())).toEqual({
            admitted: true,
            reason: `the reviewer App approved head ${HEAD}`,
        });
    });

    it('reads every page of a paginated review list', () => {
        const pages = [[review('COMMENTED', HEAD, AUTHOR_BOT_NODE_ID)], [review('APPROVED')]];
        expect(decideApprovalAdmission(input({ reviews: pages })).admitted).toBe(true);
    });

    it('refuses an approval of an older head', () => {
        expect(decideApprovalAdmission(input({ reviews: [review('APPROVED', OLDER_HEAD)] }))).toEqual({
            admitted: false,
            reason: `the reviewer App has not approved head ${HEAD}`,
        });
    });

    it('refuses a dismissed approval', () => {
        expect(decideApprovalAdmission(input({ reviews: [review('DISMISSED')] }))).toEqual({
            admitted: false,
            reason: `the reviewer App's latest review of head ${HEAD} is DISMISSED`,
        });
    });

    it('refuses an approval superseded by a later change request on the same head', () => {
        const reviews = [review('APPROVED'), review('CHANGES_REQUESTED')];
        expect(decideApprovalAdmission(input({ reviews })).admitted).toBe(false);
    });

    it('refuses an approval by anyone but the reviewer App', () => {
        expect(decideApprovalAdmission(input({ reviews: [review('APPROVED', HEAD, AUTHOR_BOT_NODE_ID)] }))).toEqual({
            admitted: false,
            reason: `the reviewer App has not approved head ${HEAD}`,
        });
    });

    it('refuses the approval label applied by anyone but the reviewer App', () => {
        expect(decideApprovalAdmission(input({ senderNodeId: AUTHOR_BOT_NODE_ID }))).toEqual({
            admitted: false,
            reason: `the approval label was applied by ${AUTHOR_BOT_NODE_ID}, not the reviewer App`,
        });
    });

    it('refuses any label other than the approval label', () => {
        expect(decideApprovalAdmission(input({ labelName: 'enhancement' }))).toEqual({
            admitted: false,
            reason: `label "enhancement" is not the approval label "${CI_APPROVAL_LABEL}"`,
        });
    });

    it('refuses a head with no approval at all', () => {
        expect(decideApprovalAdmission(input({ reviews: [] })).admitted).toBe(false);
        expect(decideApprovalAdmission(input({ reviews: [review('COMMENTED')] })).admitted).toBe(false);
    });

    it('fails closed on an unreadable review list or head', () => {
        expect(decideApprovalAdmission(input({ reviews: { message: 'Not Found' } })).admitted).toBe(false);
        expect(decideApprovalAdmission(input({ reviews: [review('APPROVED'), { state: 'APPROVED' }] })).admitted).toBe(
            false
        );
        expect(decideApprovalAdmission(input({ headSha: '' })).admitted).toBe(false);
    });

    it('keeps a hostile label name on one printable line', () => {
        expect(admissionOutputLine('label "x\nadmitted=true%0A" refused')).toBe('label "x?admitted=true?0A" refused');
    });

    // The workflow runs the decision from a sparse default-branch checkout (root files and scripts/)
    // with nothing installed, so the script and every module it imports must load from those alone.
    it('runs from a checkout holding only its own dependency-free modules', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-admission-'));
        try {
            mkdirSync(join(root, 'scripts'));
            copyFileSync(resolve(import.meta.dirname, '../../package.json'), join(root, 'package.json'));
            for (const file of ['ciApprovalAdmission.ts', 'githubAppIdentity.ts', 'prContract.ts']) {
                copyFileSync(resolve(import.meta.dirname, '..', file), join(root, 'scripts', file));
            }
            const run = (labelName: string) => {
                const output = join(root, `output-${labelName}`);
                writeFileSync(output, '');
                writeFileSync(join(root, 'reviews.json'), JSON.stringify([[review('APPROVED')]]));
                const result = spawnSync(process.execPath, ['scripts/ciApprovalAdmission.ts'], {
                    cwd: root,
                    encoding: 'utf8',
                    env: {
                        PATH: process.env.PATH,
                        REVIEWS_PATH: join(root, 'reviews.json'),
                        HEAD_SHA: HEAD,
                        LABEL_NAME: labelName,
                        SENDER_NODE_ID: REVIEWER_BOT_NODE_ID,
                        GITHUB_OUTPUT: output,
                    },
                });
                expect(result.stderr).toBe('');
                expect(result.status).toBe(0);
                return readFileSync(output, 'utf8');
            };
            expect(run(CI_APPROVAL_LABEL)).toBe(`admitted=true\nreason=the reviewer App approved head ${HEAD}\n`);
            expect(run('enhancement')).toBe(
                `admitted=false\nreason=label "enhancement" is not the approval label "${CI_APPROVAL_LABEL}"\n`
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
