import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    installBundleAtomically,
    parsePrepareReviewArgs,
    prepareReview,
    reviewBundlePath,
    type PrepareReviewPort,
    type ReviewPullRequest,
} from '../prepareReview.ts';

function pullRequest(overrides: Partial<ReviewPullRequest> = {}): ReviewPullRequest {
    return {
        number: 42,
        title: 'feat(vcs): add identities',
        body: 'Body text',
        headRefOid: 'headsha',
        baseRefOid: 'basesha',
        headRefName: 'agent/12/work',
        baseRefName: 'main',
        ...overrides,
    };
}

function fakePort(root: string) {
    const calls: string[] = [];
    const logs: string[] = [];
    const files: Record<string, string> = {};
    const port: PrepareReviewPort = {
        primaryRoot: () => root,
        pullRequest: () => pullRequest(),
        fetchShas: (base, head) => calls.push(`fetch:${base}:${head}`),
        diff: (base, head) => `diff ${base} ${head}\n`,
        showFile: (sha, path) => {
            calls.push(`show:${sha}:${path}`);
            if (path === 'AGENTS.md') {
                return 'base agents\n';
            }
            if (path === 'CLAUDE.md') {
                return 'base claude\n';
            }
            return `base ${path}\n`;
        },
        listDecisionFiles: (sha) => {
            calls.push(`decisions:${sha}`);
            return ['.agents/decisions/0026-ownership-by-exception.md'];
        },
        installBundle: (destination, bundle) => {
            calls.push(`install:${destination}`);
            Object.assign(files, bundle);
            installBundleAtomically(destination, bundle);
        },
        log: (message) => logs.push(message),
    };
    return { port, calls, logs, files };
}

describe('review prepare', () => {
    it('writes a complete bundle for the current head without review.json', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-'));
        const { port, calls, logs, files } = fakePort(root);
        try {
            const destination = prepareReview(42, port);
            expect(destination).toBe(reviewBundlePath(root, 42, 'headsha'));
            expect(logs.at(-1)).toBe(destination);
            expect(JSON.parse(files['manifest.json'] ?? '{}')).toEqual({
                pr: 42,
                baseSha: 'basesha',
                headSha: 'headsha',
            });
            expect(files['diff.patch']).toBe('diff basesha headsha\n');
            expect(files['pr.md']).toContain('feat(vcs): add identities');
            expect(files['pr.md']).toContain('Body text');
            expect(files['contracts/AGENTS.md']).toBe('base agents\n');
            expect(files['contracts/CLAUDE.md']).toBe('base claude\n');
            expect(files['contracts/.agents/decisions/0026-ownership-by-exception.md']).toBe(
                'base .agents/decisions/0026-ownership-by-exception.md\n'
            );
            expect(files['review.json']).toBeUndefined();
            expect(existsSync(join(destination, 'review.json'))).toBe(false);
            expect(calls.some((call) => call.includes('worktree') || call.includes('agent-'))).toBe(false);
            expect(JSON.stringify(files)).not.toContain('ghs_');
            expect(JSON.stringify(files)).not.toContain('BEGIN RSA');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('installs bundles with a rename so readers never see a partial directory', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(destination, { recursive: true });
            writeFileSync(join(destination, 'manifest.json'), '{"pr":42}\n');
            installBundleAtomically(destination, {
                'manifest.json': '{"pr":42,"headSha":"new"}\n',
                'diff.patch': 'x\n',
            });
            expect(readFileSync(join(destination, 'manifest.json'), 'utf8')).toContain('new');
            expect(readFileSync(join(destination, 'diff.patch'), 'utf8')).toBe('x\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('parses a pull-request number', () => {
        expect(parsePrepareReviewArgs(['42'])).toEqual({ number: 42, help: false });
        expect(() => parsePrepareReviewArgs([])).toThrow(/usage/);
    });
});
