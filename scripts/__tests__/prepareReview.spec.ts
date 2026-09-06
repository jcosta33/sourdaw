import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    installBundleAtomically,
    isProcessAlive,
    parsePrepareReviewArgs,
    prepareReview,
    reviewBundlePath,
    sweepStaleBundleSiblings,
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
        mergeBase: (base, head) => {
            calls.push(`merge-base:${base}:${head}`);
            return 'mergebasesha';
        },
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
            expect(calls).toContain('merge-base:basesha:headsha');
            expect(calls).toContain('show:mergebasesha:AGENTS.md');
            expect(calls).toContain('show:mergebasesha:CLAUDE.md');
            expect(calls).toContain('decisions:mergebasesha');
            expect(calls).toContain('show:mergebasesha:.agents/decisions/0026-ownership-by-exception.md');
            expect(JSON.parse(files['manifest.json'] ?? '{}')).toEqual({
                pr: 42,
                baseSha: 'mergebasesha',
                headSha: 'headsha',
                generated: [
                    'contracts/.agents/decisions/0026-ownership-by-exception.md',
                    'contracts/AGENTS.md',
                    'contracts/CLAUDE.md',
                    'diff.patch',
                    'manifest.json',
                    'pr.md',
                ],
            });
            expect(files['diff.patch']).toBe('diff mergebasesha headsha\n');
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

    it('resolves baseSha and contracts against the merge-base between base branch and head', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-review-'));
        const { port, calls, files } = fakePort(root);
        port.pullRequest = () =>
            pullRequest({
                baseRefOid: 'origin-main-tip',
                headRefOid: 'feature-head-sha',
            });
        port.mergeBase = (base, head) => {
            calls.push(`merge-base:${base}:${head}`);
            return 'common-ancestor-sha';
        };
        try {
            prepareReview(42, port);
            expect(calls).toContain('fetch:origin-main-tip:feature-head-sha');
            expect(calls).toContain('merge-base:origin-main-tip:feature-head-sha');
            expect(calls).toContain('show:common-ancestor-sha:AGENTS.md');
            expect(calls).toContain('show:common-ancestor-sha:CLAUDE.md');
            expect(calls).toContain('decisions:common-ancestor-sha');
            expect(calls).toContain('show:common-ancestor-sha:.agents/decisions/0026-ownership-by-exception.md');
            expect(JSON.parse(files['manifest.json'] ?? '{}')).toMatchObject({
                pr: 42,
                baseSha: 'common-ancestor-sha',
                headSha: 'feature-head-sha',
            });
            expect(files['diff.patch']).toBe('diff common-ancestor-sha feature-head-sha\n');
            expect(files['contracts/AGENTS.md']).toBe('base agents\n');
            expect(files['contracts/CLAUDE.md']).toBe('base claude\n');
            expect(files['contracts/.agents/decisions/0026-ownership-by-exception.md']).toBe(
                'base .agents/decisions/0026-ownership-by-exception.md\n'
            );
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

    it('preserves a caller-written file across a re-install of the same bundle', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(destination, { recursive: true });
            writeFileSync(join(destination, 'manifest.json'), '{"pr":42}\n');
            writeFileSync(join(destination, 'review.json'), '{"event":"APPROVE","body":"ok","comments":[]}\n');

            installBundleAtomically(destination, { 'manifest.json': '{"pr":42,"headSha":"new"}\n' });

            expect(readFileSync(join(destination, 'review.json'), 'utf8')).toBe(
                '{"event":"APPROVE","body":"ok","comments":[]}\n'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('replaces a generated file rather than pinning stale content from the previous install', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(destination, { recursive: true });
            writeFileSync(join(destination, 'manifest.json'), '{"pr":42,"headSha":"old"}\n');

            installBundleAtomically(destination, { 'manifest.json': '{"pr":42,"headSha":"new"}\n' });

            expect(readFileSync(join(destination, 'manifest.json'), 'utf8')).toBe('{"pr":42,"headSha":"new"}\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('preserves a caller-written file nested in a subdirectory when the previous generated set is known', () => {
        // Distinct from the manifest-less case below: here the previous manifest's own `generated`
        // field is present and valid, so the union rule applies and a nested caller file survives
        // even though it is not literally named in that field. The two rules must not collapse.
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(join(destination, 'notes'), { recursive: true });
            writeFileSync(
                join(destination, 'manifest.json'),
                `${JSON.stringify({ pr: 42, generated: ['manifest.json'] })}\n`
            );
            writeFileSync(join(destination, 'notes', 'caller-note.md'), 'keep me\n');

            installBundleAtomically(destination, {
                'manifest.json': `${JSON.stringify({ pr: 42, headSha: 'new', generated: ['manifest.json'] })}\n`,
            });

            expect(readFileSync(join(destination, 'notes', 'caller-note.md'), 'utf8')).toBe('keep me\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('drops a nested file but keeps a root file when the previous generated set is unknown', () => {
        // No manifest.json at all, so the previous generated set is unknown: classification falls
        // back to position rather than name. The root caller file survives; the nested one — which
        // looks exactly like a decision file a since-moved base stopped producing — does not.
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(join(destination, 'contracts', '.agents', 'decisions'), { recursive: true });
            writeFileSync(join(destination, 'review.json'), 'caller content\n');
            writeFileSync(
                join(destination, 'contracts', '.agents', 'decisions', '0027-doomed.md'),
                'a decision main has since deleted\n'
            );

            installBundleAtomically(destination, { 'manifest.json': '{"pr":42,"headSha":"new"}\n' });

            expect(readFileSync(join(destination, 'review.json'), 'utf8')).toBe('caller content\n');
            expect(existsSync(join(destination, 'contracts', '.agents', 'decisions', '0027-doomed.md'))).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('preserves review.json across a re-install of a bundle with no manifest.json', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(destination, { recursive: true });
            writeFileSync(join(destination, 'review.json'), 'caller content\n');

            installBundleAtomically(destination, { 'manifest.json': '{"pr":42,"headSha":"new"}\n' });

            expect(readFileSync(join(destination, 'review.json'), 'utf8')).toBe('caller content\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('preserves review.json across a re-install of a bundle with an unparseable manifest.json', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(destination, { recursive: true });
            writeFileSync(join(destination, 'manifest.json'), 'not json{{{\n');
            writeFileSync(join(destination, 'review.json'), 'caller content\n');

            installBundleAtomically(destination, { 'manifest.json': '{"pr":42,"headSha":"new"}\n' });

            expect(readFileSync(join(destination, 'review.json'), 'utf8')).toBe('caller content\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('treats a manifest generated array containing a non-string element as unknown, dropping a nested file', () => {
        // If the element-type guard were relaxed to accept anything, `[ 'manifest.json', 7 ]` would
        // be read as a KNOWN previous set and the nested file below would survive under the union
        // rule instead of being dropped under the unknown-set rootOnly rule — that difference is
        // what this test observes, not just whether the root file survives (both paths keep that).
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(join(destination, 'contracts'), { recursive: true });
            writeFileSync(
                join(destination, 'manifest.json'),
                `${JSON.stringify({ pr: 42, generated: ['manifest.json', 7] })}\n`
            );
            writeFileSync(join(destination, 'review.json'), 'caller content\n');
            writeFileSync(join(destination, 'contracts', 'nested.md'), 'nested\n');

            installBundleAtomically(destination, { 'manifest.json': '{"pr":42,"headSha":"new"}\n' });

            expect(readFileSync(join(destination, 'review.json'), 'utf8')).toBe('caller content\n');
            expect(existsSync(join(destination, 'contracts', 'nested.md'))).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('leaves the destination untouched, caller files included, when writing staging throws', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(destination, { recursive: true });
            writeFileSync(join(destination, 'manifest.json'), '{"pr":42}\n');
            writeFileSync(join(destination, 'review.json'), 'caller content\n');

            // 'a' is written as a file, then 'a/b' asks to create a directory at that same path —
            // Node's recursive mkdir throws ENOTDIR, forcing the write loop to fail mid-staging.
            expect(() => installBundleAtomically(destination, { a: 'x', 'a/b': 'y' })).toThrow();

            expect(readFileSync(join(destination, 'manifest.json'), 'utf8')).toBe('{"pr":42}\n');
            expect(readFileSync(join(destination, 'review.json'), 'utf8')).toBe('caller content\n');
            expect(readdirSync(root)).toEqual(['42-head']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('leaves the destination and its caller files untouched when a preservation copy fails', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(destination, { recursive: true });
            writeFileSync(join(destination, 'manifest.json'), '{"pr":42}\n');
            writeFileSync(join(destination, 'review.json'), 'caller content\n');
            // A caller file literally named `contracts` collides with the `contracts/` directory
            // this install generates: staging already holds `contracts/AGENTS.md` as a directory by
            // the time preservation tries to write the caller's flat file to that same path, so the
            // copy hits EISDIR. This must fail while `destination` is still live and untouched — it
            // would fail with `destination` already renamed away if preservation ran after the
            // destination-to-previous rename instead of before it.
            writeFileSync(join(destination, 'contracts'), 'not a directory\n');

            expect(() => installBundleAtomically(destination, { 'contracts/AGENTS.md': 'agents content\n' })).toThrow();

            expect(readFileSync(join(destination, 'manifest.json'), 'utf8')).toBe('{"pr":42}\n');
            expect(readFileSync(join(destination, 'review.json'), 'utf8')).toBe('caller content\n');
            expect(readFileSync(join(destination, 'contracts'), 'utf8')).toBe('not a directory\n');
            expect(readdirSync(root)).toEqual(['42-head']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('drops a file the previous run generated but this run does not, rather than treating it as caller-written', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(join(destination, 'contracts'), { recursive: true });
            writeFileSync(
                join(destination, 'manifest.json'),
                `${JSON.stringify({
                    pr: 42,
                    baseSha: 'old-base',
                    headSha: 'head',
                    generated: ['manifest.json', 'contracts/0027-old.md'],
                })}\n`
            );
            writeFileSync(join(destination, 'contracts', '0027-old.md'), 'a decision main has since deleted\n');
            writeFileSync(join(destination, 'review.json'), 'caller content\n');

            installBundleAtomically(destination, {
                'manifest.json': `${JSON.stringify({
                    pr: 42,
                    baseSha: 'new-base',
                    headSha: 'head',
                    generated: ['manifest.json'],
                })}\n`,
            });

            expect(existsSync(join(destination, 'contracts', '0027-old.md'))).toBe(false);
            expect(readFileSync(join(destination, 'review.json'), 'utf8')).toBe('caller content\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('leaves no .previous- or .staging- sibling after a successful re-install', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            mkdirSync(destination, { recursive: true });
            writeFileSync(join(destination, 'manifest.json'), '{"pr":42}\n');

            installBundleAtomically(destination, { 'manifest.json': '{"pr":42,"headSha":"new"}\n' });

            expect(readdirSync(root)).toEqual(['42-head']);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    describe('isProcessAlive', () => {
        it('returns true for process.pid', () => {
            expect(isProcessAlive(process.pid)).toBe(true);
        });

        it('returns false for invalid and unallocated process ids', () => {
            expect(isProcessAlive(0)).toBe(false);
            expect(isProcessAlive(-1)).toBe(false);
            expect(isProcessAlive(Number.NaN)).toBe(false);
            expect(isProcessAlive(1.5)).toBe(false);
            expect(isProcessAlive(2147483647)).toBe(false);
        });
    });

    describe('sweepStaleBundleSiblings', () => {
        it('reclaims dead .staging-* and .previous-* sibling directories when process is dead', () => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
            const destination = join(root, '42-head');
            try {
                const deadStaging = join(root, '42-head.staging-99999-1000');
                const deadPrevious = join(root, '42-head.previous-99999-2000');
                mkdirSync(deadStaging, { recursive: true });
                mkdirSync(deadPrevious, { recursive: true });
                writeFileSync(join(deadStaging, 'file.txt'), 'stale staging');
                writeFileSync(join(deadPrevious, 'file.txt'), 'stale previous');

                sweepStaleBundleSiblings(destination, (pid) => pid !== 99999);

                expect(existsSync(deadStaging)).toBe(false);
                expect(existsSync(deadPrevious)).toBe(false);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        it('preserves active sibling directories when process is alive', () => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
            const destination = join(root, '42-head');
            try {
                const activeStaging = join(root, '42-head.staging-12345-1000');
                const activePrevious = join(root, '42-head.previous-12345-2000');
                mkdirSync(activeStaging, { recursive: true });
                mkdirSync(activePrevious, { recursive: true });

                sweepStaleBundleSiblings(destination, (pid) => pid === 12345);

                expect(existsSync(activeStaging)).toBe(true);
                expect(existsSync(activePrevious)).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        it('ignores non-directory entries and entries that do not match the staging/previous pattern', () => {
            const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
            const destination = join(root, '42-head');
            try {
                const nonDirMatching = join(root, '42-head.staging-99999-1000');
                const otherDir = join(root, 'other-dir');
                const otherFile = join(root, 'some-file.txt');
                const nonMatchingDir = join(root, '42-head.other-99999-1000');

                writeFileSync(nonDirMatching, 'not a dir');
                mkdirSync(otherDir, { recursive: true });
                writeFileSync(otherFile, 'hello');
                mkdirSync(nonMatchingDir, { recursive: true });

                sweepStaleBundleSiblings(destination, () => false);

                expect(existsSync(nonDirMatching)).toBe(true);
                expect(existsSync(otherDir)).toBe(true);
                expect(existsSync(otherFile)).toBe(true);
                expect(existsSync(nonMatchingDir)).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        it('returns cleanly when destination parent directory does not exist', () => {
            const nonExistentDestination = join(tmpdir(), `non-existent-${Date.now()}`, 'sub', 'bundle');
            expect(() => sweepStaleBundleSiblings(nonExistentDestination)).not.toThrow();
        });
    });

    it('cleans up dead staging siblings while installing the new bundle', () => {
        const root = mkdtempSync(join(tmpdir(), 'sourdaw-bundle-'));
        const destination = join(root, '42-head');
        try {
            const deadStaging = join(root, '42-head.staging-99999-1000');
            const deadPrevious = join(root, '42-head.previous-99999-2000');
            const liveStaging = join(root, '42-head.staging-12345-3000');
            mkdirSync(deadStaging, { recursive: true });
            mkdirSync(deadPrevious, { recursive: true });
            mkdirSync(liveStaging, { recursive: true });
            writeFileSync(join(deadStaging, 'orphan.txt'), 'stale');

            installBundleAtomically(
                destination,
                { 'manifest.json': '{"pr":42,"headSha":"new"}\n' },
                (pid) => pid === 12345
            );

            expect(existsSync(deadStaging)).toBe(false);
            expect(existsSync(deadPrevious)).toBe(false);
            expect(existsSync(liveStaging)).toBe(true);
            expect(existsSync(destination)).toBe(true);
            expect(readFileSync(join(destination, 'manifest.json'), 'utf8')).toContain('new');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
