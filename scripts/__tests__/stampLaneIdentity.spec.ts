import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { AUTHOR_BOT_COMMIT_EMAIL, AUTHOR_BOT_COMMIT_NAME, AUTHOR_LOCK_REASON } from '../githubAppIdentity.ts';
import { shellPort, stampLaneIdentities } from '../stampLaneIdentity.ts';

/**
 * `lane:identity` is the backfill route `lane:publish`'s authorship refusal names, so the fixture
 * is a real primary checkout with real worktrees: the claim under test is which worktrees' scoped
 * git config changes, and that is only honest when real git writes and reads it.
 */
const scratchRoots: string[] = [];
afterAll(() => {
    for (const root of scratchRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function fixtureGit(repository: string, args: string[]): string {
    return execFileSync('git', args, {
        cwd: repository,
        encoding: 'utf8',
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    }).trim();
}

function primaryFixture(): {
    root: string;
    authorLane: string;
    scratchLane: string;
    foreignLockLane: string;
    strayLockLane: string;
} {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-lane-identity-')));
    scratchRoots.push(root);
    fixtureGit(root, ['init', '-b', 'main']);
    fixtureGit(root, ['config', 'user.name', 'Fixture']);
    fixtureGit(root, ['config', 'user.email', 'fixture@example.com']);
    writeFileSync(join(root, '.gitignore'), '.agents/\n');
    fixtureGit(root, ['add', '.gitignore']);
    fixtureGit(root, ['commit', '--no-gpg-sign', '-m', 'chore: base']);
    const authorLane = join(root, '.agents', 'worktrees', 'agent-12-work');
    fixtureGit(root, ['worktree', 'add', '-b', 'agent/12/work', authorLane]);
    fixtureGit(root, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, authorLane]);
    const scratchLane = join(root, '.agents', 'worktrees', 'scratch');
    fixtureGit(root, ['worktree', 'add', '-b', 'scratch-branch', scratchLane]);
    // The negatives pin the two `authorLanes` predicates a porcelain worktree record can falsify —
    // the lock reason and the `agent/` branch prefix — so deleting either turns the spec red: this
    // one is branch-shaped but locked for a different purpose. The remaining `locked` predicate is
    // logically implied by the lock-reason check on porcelain records (`lockReason` is derived only
    // from the `locked` field), so no worktree-list fixture can falsify it; its deletion alone
    // would stay green and is guarded by this comment instead.
    const foreignLockLane = join(root, '.agents', 'worktrees', 'agent-13-foreign-lock');
    fixtureGit(root, ['worktree', 'add', '-b', 'agent/13/foreign-lock', foreignLockLane]);
    fixtureGit(root, ['worktree', 'lock', '--reason', 'lane-remove:12345', foreignLockLane]);
    // And this one carries the exact author lock but on a non-agent branch.
    const strayLockLane = join(root, '.agents', 'worktrees', 'stray-author-lock');
    fixtureGit(root, ['worktree', 'add', '-b', 'collab/session', strayLockLane]);
    fixtureGit(root, ['worktree', 'lock', '--reason', AUTHOR_LOCK_REASON, strayLockLane]);
    return { root, authorLane, scratchLane, foreignLockLane, strayLockLane };
}

/** The per-worktree config file a `--worktree` write lands in; its existence is the scoped state. */
function worktreeConfigFile(root: string, worktreeName: string): string {
    return join(root, '.git', 'worktrees', worktreeName, 'config.worktree');
}

describe('lane identity stamping', () => {
    it('stamps exactly the locked author lanes and leaves every other worktree unstamped', () => {
        const f = primaryFixture();

        const stamps = stampLaneIdentities(shellPort(f.root));

        expect(stamps).toEqual([{ lane: f.authorLane, changedKeys: ['user.name', 'user.email', 'commit.gpgsign'] }]);
        expect(fixtureGit(f.authorLane, ['config', 'user.name'])).toBe(AUTHOR_BOT_COMMIT_NAME);
        expect(fixtureGit(f.authorLane, ['config', 'user.email'])).toBe(AUTHOR_BOT_COMMIT_EMAIL);
        expect(fixtureGit(f.authorLane, ['config', 'commit.gpgsign'])).toBe('false');
        expect(existsSync(worktreeConfigFile(f.root, 'agent-12-work'))).toBe(true);
        expect(existsSync(worktreeConfigFile(f.root, 'scratch'))).toBe(false);
        expect(existsSync(worktreeConfigFile(f.root, 'agent-13-foreign-lock'))).toBe(false);
        expect(existsSync(worktreeConfigFile(f.root, 'stray-author-lock'))).toBe(false);
    });

    it('reports a stamped lane as already carrying the identity on a second run', () => {
        const f = primaryFixture();
        stampLaneIdentities(shellPort(f.root));

        const second = stampLaneIdentities(shellPort(f.root));

        expect(second).toEqual([{ lane: f.authorLane, changedKeys: [] }]);
        expect(fixtureGit(f.authorLane, ['config', 'user.email'])).toBe(AUTHOR_BOT_COMMIT_EMAIL);
    });
});
