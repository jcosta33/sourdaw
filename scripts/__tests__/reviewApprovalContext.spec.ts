import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID, GITHUB_HTTPS_REMOTE, spawnCapture } from '../githubAppIdentity.ts';
import { shellPort } from '../publishReview.ts';
import { writeLaneStack, type LaneStack } from '../stackedLanes.ts';

function fixture(parentMergedAt: string | null = '2026-09-13', env: NodeJS.ProcessEnv = {}) {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-approval-context-'));
    const git = (args: string[]) => spawnCapture('git', args, { cwd: root });
    git(['init', '-b', 'main']);
    git(['config', 'user.name', 'Fixture']);
    git(['config', 'user.email', 'fixture@example.test']);
    const commit = (path: string) => {
        writeFileSync(join(root, path), path);
        git(['add', path]);
        git(['commit', '-m', path]);
        return git(['rev-parse', 'HEAD']);
    };
    const base = commit('base');
    git(['checkout', '-b', 'agent/child']);
    const head = commit('child');
    git(['checkout', 'main']);
    const advancedMain = commit('unrelated');
    const bundle = join(root, '.agents', 'review-bundles', `42-${head}`);
    mkdirSync(bundle, { recursive: true });
    const context = { pr: 42, headSha: head, baseRefName: 'main', baseSha: base };
    writeFileSync(join(bundle, 'manifest.json'), JSON.stringify(context));
    const live = {
        number: 42,
        state: 'OPEN',
        headRefOid: head,
        headRefName: 'agent/child',
        baseRefName: 'main',
        baseRefOid: base,
    };
    const parent = {
        number: 40,
        state: 'closed',
        merged_at: parentMergedAt,
        merge_commit_sha: base,
        head: { ref: 'agent/parent', sha: base, repo: { full_name: 'jcosta33/sourdaw' } },
        user: { node_id: AUTHOR_BOT_NODE_ID },
    };
    const calls: string[][] = [];
    const fetchEnvironments: (NodeJS.ProcessEnv | undefined)[] = [];
    const capture: typeof spawnCapture = (command, args, options) => {
        calls.push([command, ...args]);
        if (command === 'gh') {
            if (args[0] === 'pr') {
                return JSON.stringify(live);
            }
            if (args.includes('--paginate')) {
                return JSON.stringify([[parent]]);
            }
            throw new Error('unexpected GitHub mutation');
        }
        if (args.includes('fetch')) {
            fetchEnvironments.push(options?.env);
            return '';
        }
        return spawnCapture(command, args, options);
    };
    const port = shellPort({ configDir: root, env, dispose: () => undefined }, root, capture);
    const read = () => {
        if (port.assertApprovalContext === undefined) {
            throw new Error('missing real-shell context reader');
        }
        return port.assertApprovalContext(42, head, bundle);
    };
    const register = (pinned = true) => {
        git(['config', 'branch.agent/child.sourdaw-stack-fork', base]);
        const descriptor: LaneStack = {
            version: 1,
            childBranch: 'agent/child',
            parentBranch: 'agent/parent',
            forkHead: base,
            parentHead: base,
        };
        if (pinned) {
            descriptor.parentPullRequest = 40;
        }
        writeLaneStack(root, descriptor);
    };
    return {
        root,
        git,
        context,
        live,
        parent,
        calls,
        fetchEnvironments,
        read,
        register,
        base,
        head,
        advancedMain,
        bundle,
    };
}

describe('real shell approval context', () => {
    it.each(['gho_synthetic_user', 'ghs_synthetic_bot'])(
        'fetches through the isolated role credential protocol for %s',
        (token) => {
            const env = { GH_TOKEN: token, SOURDAW_TRUSTED_GH_PATH: "/trusted/O'Brien Tools/gh" };
            const f = fixture(undefined, env);
            try {
                expect(f.read()).toEqual(f.context);
                expect(f.calls.find((args) => args.includes('fetch'))).toEqual([
                    'git',
                    '-c',
                    'credential.helper=',
                    '-c',
                    "credential.helper=!'/trusted/O'\\''Brien Tools/gh' auth git-credential",
                    'fetch',
                    '--no-write-fetch-head',
                    GITHUB_HTTPS_REMOTE,
                    f.base,
                    f.head,
                ]);
                expect(f.fetchEnvironments).toEqual([env]);
                expect(JSON.stringify(f.calls)).not.toContain(token);
                expect(existsSync(join(f.root, 'git-credential-github'))).toBe(false);
            } finally {
                rmSync(f.root, { recursive: true, force: true });
            }
        }
    );
    it('uses the actual merge-base and allows unrelated main movement', () => {
        const f = fixture();
        try {
            expect(f.read()).toEqual(f.context);
            f.live.baseRefOid = f.advancedMain;
            expect(f.read()).toEqual(f.context);
            expect(f.calls.some((args) => args.includes('fetch') && args.includes(f.advancedMain))).toBe(true);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it.each(['base', 'manifest', 'head', 'merge-base', 'missing-manifest'])('refuses %s context drift', (kind) => {
        const f = fixture();
        try {
            if (kind === 'base') {
                f.live.baseRefName = 'agent/parent';
            }
            if (kind === 'head') {
                f.live.headRefOid = f.base;
            }
            if (kind === 'merge-base') {
                f.live.baseRefOid = f.head;
            }
            if (kind === 'manifest') {
                writeFileSync(join(f.bundle, 'manifest.json'), JSON.stringify({ ...f.context, baseSha: f.head }));
            }
            if (kind === 'missing-manifest') {
                rmSync(join(f.bundle, 'manifest.json'));
            }
            expect(f.read).toThrow();
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it('admits a pinned landed parent present in both main and child', () => {
        const f = fixture();
        try {
            f.register();
            expect(f.read()).toEqual(f.context);
            expect(f.calls.some((args) => args.includes('--paginate') && args.includes('--slurp'))).toBe(true);
        } finally {
            rmSync(f.root, { recursive: true, force: true });
        }
    });

    it.each(['open', 'unpinned', 'unrecorded-parent', 'unreconciled', 'missing-descriptor'])(
        'refuses %s stack state',
        (kind) => {
            const f = fixture();
            try {
                f.register(kind !== 'unrecorded-parent');
                if (kind === 'open') {
                    f.parent.state = 'open';
                    f.parent.merged_at = null;
                }
                if (kind === 'unpinned') {
                    f.parent.number = 41;
                }
                if (kind === 'unreconciled') {
                    f.live.baseRefOid = f.advancedMain;
                    f.parent.merge_commit_sha = f.advancedMain;
                }
                if (kind === 'missing-descriptor') {
                    rmSync(join(f.root, '.agents', 'lane-stacks'), { recursive: true });
                }
                expect(f.read).toThrow();
            } finally {
                rmSync(f.root, { recursive: true, force: true });
            }
        }
    );
});
