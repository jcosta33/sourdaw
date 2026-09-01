import { execFileSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTHOR_BOT_NODE_ID } from '../githubAppIdentity.ts';
import { supersessionCommentBody } from '../prContract.ts';
import {
    parseStrandArgs,
    parseWorktrees,
    removeLane,
    resolveLaneTarget,
    shellPort,
    strandLane,
    STRAND_RECEIPTS_DIR,
    type IssueComment,
    type LaneRemovalPort,
    type LaneStrandPort,
    type PullRequest,
    type ReplacementPullRequest,
    type ShellRunner,
    type Worktree,
} from '../removeLane';

const root = '/repo';
const target = '/repo/.agents/worktrees/feature';

function worktree(overrides: Partial<Worktree> = {}): Worktree {
    return {
        path: target,
        head: 'head',
        branch: 'feat/work',
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
        ...overrides,
    };
}

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
    return {
        number: 42,
        state: 'MERGED',
        isDraft: false,
        headRefName: 'feat/work',
        headRefOid: 'head',
        headRepository: 'jcosta33/sourdaw',
        mergedAt: '2026-08-12T00:00:00Z',
        ...overrides,
    };
}

function supersessionReceipt(replacement = 99, overrides: Partial<IssueComment> = {}): IssueComment {
    return {
        body: supersessionCommentBody(replacement),
        authorNodeId: AUTHOR_BOT_NODE_ID,
        authorLogin: 'renamed-author[bot]',
        authorType: 'Bot',
        ...overrides,
    };
}

function supersededPullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
    return pullRequest({ state: 'CLOSED', mergedAt: null, ...overrides });
}

type FakeInput = {
    root?: string;
    lane?: Worktree;
    currentDirectory?: string;
    active?: boolean;
    alive?: boolean;
    dirty?: boolean;
    ignored?: string[];
    operation?: string;
    remoteHead?: string | null;
    pullRequests?: PullRequest[];
    comments?: IssueComment[];
    replacement?: Partial<ReplacementPullRequest>;
};

function fakePort(input: FakeInput = {}) {
    const calls: string[] = [];
    let locked = input.lane?.locked ?? false;
    const lane = input.lane ?? worktree();
    const port: LaneRemovalPort = {
        fetch: () => calls.push('fetch'),
        repository: () => 'jcosta33/sourdaw',
        currentDirectory: () => input.currentDirectory ?? input.root ?? root,
        worktrees: () => [worktree({ path: input.root ?? root, branch: 'main' }), { ...lane, locked }],
        active: () => input.active ?? false,
        processAlive: () => input.alive ?? true,
        dirty: () => input.dirty ?? false,
        ignored: () => input.ignored ?? [],
        operation: () => input.operation,
        remoteHead: () => (input.remoteHead === null ? undefined : (input.remoteHead ?? 'head')),
        pullRequests: () => input.pullRequests ?? [pullRequest()],
        comments: (number) => {
            calls.push(`comments:${number}`);
            return input.comments ?? [];
        },
        replacement: (number) => {
            calls.push(`replacement:${number}`);
            return {
                number,
                state: 'MERGED',
                mergedAt: '2026-08-20T00:00:00Z',
                ...input.replacement,
            };
        },
        lock: (path) => {
            calls.push(`lock:${path}`);
            locked = true;
        },
        unlock: (path) => {
            calls.push(`unlock:${path}`);
            locked = false;
        },
        remove: (path) => calls.push(`remove:${path}`),
    };
    return { port, calls };
}

function fakeStrandPort(input: FakeInput = {}) {
    const base = fakePort(input);
    const receipts: Array<{ laneName: string; body: string }> = [];
    // The receipt files as the strand flow sees them: written by `writeReceipt`, read back by
    // `readReceipt`, exactly like the primary root's `.agents/lane-strands/` directory.
    const receiptFiles = new Map<string, string>();
    const port: LaneStrandPort = {
        ...base.port,
        readReceipt: (laneName) => receiptFiles.get(laneName),
        writeReceipt: (laneName, body) => {
            receipts.push({ laneName, body });
            receiptFiles.set(laneName, body);
            base.calls.push(`receipt:${laneName}`);
        },
        deleteBranch: (branch) => {
            base.calls.push(`branch:-D:${branch}`);
        },
        log: (message) => {
            base.calls.push(`log:${message}`);
        },
    };
    return { port, calls: base.calls, receipts, receiptFiles };
}

describe('lane removal', () => {
    it('recognizes an aliased registered lane while preserving aliased safety boundaries', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-'));
        const aliasParent = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-link-'));
        const worktreeParent = mkdtempSync(join(tmpdir(), 'sourdaw-lane-agent-root-'));
        const alias = join(aliasParent, 'repository');
        const worktreeRoot = join(worktreeParent, 'worktrees');
        const lane = join(worktreeRoot, 'feature');
        try {
            mkdirSync(join(lane, 'scripts'), { recursive: true });
            mkdirSync(join(repository, '.agents'), { recursive: true });
            symlinkSync(worktreeRoot, join(repository, '.agents/worktrees'), 'dir');
            symlinkSync(repository, alias, 'dir');
            const canonicalLane = realpathSync(lane);
            const canonicalAgentRoot = realpathSync(join(repository, '.agents/worktrees'));
            const aliasedLane = join(alias, '.agents/worktrees/feature');

            const admitted = fakePort({ root: alias, lane: worktree({ path: canonicalLane }) });
            removeLane(canonicalLane, admitted.port);
            expect(admitted.calls).toContain(`remove:${canonicalLane}`);

            const primary = fakePort({ root: alias });
            expect(() => removeLane(repository, primary.port)).toThrow(/primary/);

            const agentRootPort = fakePort({
                root: alias,
                lane: worktree({ path: canonicalAgentRoot }),
            });
            expect(() => removeLane(canonicalAgentRoot, agentRootPort.port)).toThrow(/not an agent worktree/);

            const active = fakePort({
                root: alias,
                lane: worktree({ path: canonicalLane }),
                currentDirectory: join(aliasedLane, 'scripts'),
            });
            expect(() => removeLane(canonicalLane, active.port)).toThrow(/active worktree/);
        } finally {
            rmSync(aliasParent, { recursive: true, force: true });
            rmSync(worktreeParent, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('refuses multiple registered aliases for one canonical lane', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-duplicate-'));
        const aliasParent = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-duplicate-link-'));
        const alias = join(aliasParent, 'repository');
        const lane = join(repository, '.agents/worktrees/feature');
        try {
            mkdirSync(lane, { recursive: true });
            symlinkSync(repository, alias, 'dir');
            const canonicalLane = realpathSync(lane);
            const aliasedLane = join(alias, '.agents/worktrees/feature');
            const registered = worktree({
                path: canonicalLane,
                locked: true,
                lockReason: 'active:sourdaw-author',
            });
            const { port, calls } = fakePort({ root: repository, lane: registered });
            port.worktrees = () => [
                worktree({ path: repository, branch: 'main' }),
                registered,
                { ...registered, path: aliasedLane },
            ];

            expect(() => removeLane(canonicalLane, port)).toThrow(/does not identify one registered worktree/);
            expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
        } finally {
            rmSync(aliasParent, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('refuses a removal when the later worktree snapshot changes registered alias', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-snapshot-'));
        const aliasParent = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-snapshot-link-'));
        const alias = join(aliasParent, 'repository');
        const lane = join(repository, '.agents/worktrees/feature');
        try {
            mkdirSync(lane, { recursive: true });
            symlinkSync(repository, alias, 'dir');
            const canonicalLane = realpathSync(lane);
            const first = worktree({
                path: join(alias, '.agents/worktrees/feature'),
                locked: true,
                lockReason: 'active:sourdaw-author',
            });
            const later = worktree({
                path: canonicalLane,
                locked: true,
                lockReason: 'active:sourdaw-author',
            });
            const { port, calls } = fakePort({ root: repository, lane: first });
            let reads = 0;
            port.worktrees = () => {
                reads += 1;
                return [worktree({ path: repository, branch: 'main' }), reads > 2 ? later : first];
            };

            expect(() => removeLane(canonicalLane, port)).toThrow(/identity changed during removal/);
            expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
        } finally {
            rmSync(aliasParent, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('refuses a removal when the final snapshot registers the same canonical lane twice', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-remove-duplicate-'));
        const aliasParent = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-remove-duplicate-link-'));
        const alias = join(aliasParent, 'repository');
        const lane = join(repository, '.agents/worktrees/feature');
        try {
            mkdirSync(lane, { recursive: true });
            symlinkSync(repository, alias, 'dir');
            const canonicalLane = realpathSync(lane);
            const first = worktree({
                path: join(alias, '.agents/worktrees/feature'),
                locked: true,
                lockReason: 'active:sourdaw-author',
            });
            const duplicate = worktree({
                path: canonicalLane,
                locked: true,
                lockReason: 'active:sourdaw-author',
            });
            const { port, calls } = fakePort({ root: repository, lane: first });
            let reads = 0;
            port.worktrees = () => {
                reads += 1;
                return [worktree({ path: repository, branch: 'main' }), first, ...(reads > 2 ? [duplicate] : [])];
            };

            expect(() => removeLane(canonicalLane, port)).toThrow(/identity changed during removal/);
            expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
        } finally {
            rmSync(aliasParent, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('refuses a strand when the later worktree snapshot changes registered alias', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-strand-snapshot-'));
        const aliasParent = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-strand-snapshot-link-'));
        const alias = join(aliasParent, 'repository');
        const lane = join(repository, '.agents/worktrees/feature');
        try {
            mkdirSync(lane, { recursive: true });
            symlinkSync(repository, alias, 'dir');
            const canonicalLane = realpathSync(lane);
            const first = worktree({
                path: join(alias, '.agents/worktrees/feature'),
                locked: true,
                lockReason: 'active:sourdaw-author',
            });
            const later = worktree({
                path: canonicalLane,
                locked: true,
                lockReason: 'active:sourdaw-author',
            });
            const { port, calls, receipts } = fakeStrandPort({ root: repository, lane: first });
            let reads = 0;
            port.worktrees = () => {
                reads += 1;
                return [worktree({ path: repository, branch: 'main' }), reads > 2 ? later : first];
            };

            expect(() => strandLane(canonicalLane, 'registered identity changed', port)).toThrow(
                /identity changed during stranding/
            );
            expect(receipts).toEqual([]);
            expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
        } finally {
            rmSync(aliasParent, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('refuses a strand when the final snapshot registers the same canonical lane twice', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-strand-duplicate-'));
        const aliasParent = mkdtempSync(join(tmpdir(), 'sourdaw-lane-alias-strand-duplicate-link-'));
        const alias = join(aliasParent, 'repository');
        const lane = join(repository, '.agents/worktrees/feature');
        try {
            mkdirSync(lane, { recursive: true });
            symlinkSync(repository, alias, 'dir');
            const canonicalLane = realpathSync(lane);
            const first = worktree({
                path: join(alias, '.agents/worktrees/feature'),
                locked: true,
                lockReason: 'active:sourdaw-author',
            });
            const duplicate = worktree({
                path: canonicalLane,
                locked: true,
                lockReason: 'active:sourdaw-author',
            });
            const { port, calls, receipts } = fakeStrandPort({ root: repository, lane: first });
            let reads = 0;
            port.worktrees = () => {
                reads += 1;
                return [worktree({ path: repository, branch: 'main' }), first, ...(reads > 2 ? [duplicate] : [])];
            };

            expect(() => strandLane(canonicalLane, 'duplicate registered identity', port)).toThrow(
                /identity changed during stranding/
            );
            expect(receipts).toEqual([]);
            expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
            expect(calls.some((call) => call.startsWith('branch:-D:'))).toBe(false);
        } finally {
            rmSync(aliasParent, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('removes a clean inactive lane after two stable reads', () => {
        const { port, calls } = fakePort();

        removeLane(target, port);

        expect(calls).toEqual(['fetch', `lock:${target}`, `unlock:${target}`, `remove:${target}`]);
    });

    it('accepts a pruned remote branch when local and merged GitHub heads agree', () => {
        const { port, calls } = fakePort({ remoteHead: null });

        removeLane(target, port);

        expect(calls).toContain(`remove:${target}`);
    });

    it.each([
        ['primary', root, {}, /primary/],
        [
            'agent root',
            `${root}/.agents/worktrees`,
            { lane: worktree({ path: `${root}/.agents/worktrees` }) },
            /not an agent/,
        ],
        ['outside', '/tmp/feature', { lane: worktree({ path: '/tmp/feature' }) }, /not an agent worktree/],
        ['active', target, { currentDirectory: `${target}/scripts` }, /active worktree/],
        ['other process', target, { active: true }, /active in another process/],
        ['locked', target, { lane: worktree({ locked: true }) }, /locked or shared/],
        ['detached', target, { lane: worktree({ branch: undefined, detached: true }) }, /ownership is unknown/],
        ['dirty', target, { dirty: true }, /dirty/],
        ['ignored data', target, { ignored: ['.env'] }, /ignored data/],
        ['operation', target, { operation: 'rebase' }, /active rebase/],
        ['open PR', target, { pullRequests: [pullRequest({ state: 'OPEN', mergedAt: null })] }, /still active/],
        [
            'open draft PR',
            target,
            { pullRequests: [pullRequest({ state: 'OPEN', mergedAt: null, isDraft: true })] },
            /still active/,
        ],
        ['foreign repository', target, { pullRequests: [pullRequest({ headRepository: 'jcosta33/fork' })] }, /foreign/],
        ['reused branch', target, { pullRequests: [pullRequest(), pullRequest({ number: 43 })] }, /one pull request/],
        ['moved remote', target, { remoteHead: 'moved' }, /ownership is unproven/],
        [
            'merged PR with a mismatched head',
            target,
            { pullRequests: [pullRequest({ headRefOid: 'ahead' })] },
            /ownership is unproven/,
        ],
        [
            'superseded PR with a mismatched head',
            target,
            {
                remoteHead: null,
                pullRequests: [supersededPullRequest({ headRefOid: 'ahead' })],
                comments: [supersessionReceipt(99)],
            },
            /ownership is unproven/,
        ],
    ])('rejects a %s lane', (_case, path, input, message) => {
        const { port, calls } = fakePort(input);

        expect(() => removeLane(path, port)).toThrow(message);
        expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
    });

    /**
     * `pr:supersede` closes the old pull request unmerged, so state alone reads the same as an
     * abandoned lane. The receipt it leaves is the only thing that separates them, and the lane
     * holds a share of the shared author lock until removal succeeds.
     */
    it('removes a superseded lane whose replacement merged', () => {
        const { port, calls } = fakePort({
            pullRequests: [supersededPullRequest()],
            comments: [supersessionReceipt(99)],
        });

        let thrown: unknown;
        try {
            removeLane(target, port);
        } catch (error) {
            thrown = error;
        }

        expect(thrown, 'a superseded lane, and the share of the author lock it holds, stayed stranded').toBeUndefined();
        expect(calls).toContain('comments:42');
        expect(calls).toContain('replacement:99');
        expect(calls).toContain(`remove:${target}`);
    });

    /**
     * `supersessionReplacement` returns `undefined` for a comment that is not receipt-shaped, and
     * that entry must not still count toward the receipt total: one parsed receipt plus one
     * unrelated author-bot comment is one receipt, not two.
     */
    it('removes a superseded lane carrying one valid receipt alongside an unrelated author-bot comment', () => {
        const { port, calls } = fakePort({
            pullRequests: [supersededPullRequest()],
            comments: [supersessionReceipt(99), supersessionReceipt(99, { body: 'Thanks for the update!' })],
        });

        let thrown: unknown;
        try {
            removeLane(target, port);
        } catch (error) {
            thrown = error;
        }

        expect(thrown, 'a valid receipt was outvoted by an unparsed comment').toBeUndefined();
        expect(calls).toContain(`remove:${target}`);
    });

    /**
     * The draft flag says nothing about whether the work landed. `pr:supersede` can close a draft
     * pull request against a genuinely merged replacement, and that lane must be removable through
     * the same receipt path a non-draft superseded lane uses.
     */
    it('removes a superseded draft carrying a valid receipt naming a merged replacement', () => {
        const { port, calls } = fakePort({
            pullRequests: [supersededPullRequest({ isDraft: true })],
            comments: [supersessionReceipt(99)],
        });

        let thrown: unknown;
        try {
            removeLane(target, port);
        } catch (error) {
            thrown = error;
        }

        expect(
            thrown,
            'a superseded draft, and the share of the author lock it holds, stayed stranded'
        ).toBeUndefined();
        expect(calls).toContain(`remove:${target}`);
    });

    it.each([
        [
            'closed with no receipt at all',
            { pullRequests: [supersededPullRequest()], comments: [] },
            /closed without a supersession receipt/,
        ],
        [
            'closed draft with no receipt',
            { pullRequests: [supersededPullRequest({ isDraft: true })], comments: [] },
            /closed without a supersession receipt/,
        ],
        [
            'closed carrying an unrelated author-bot comment',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99, { body: 'Done' })],
            },
            /closed without a supersession receipt/,
        ],
        [
            'closed carrying a receipt nobody trusted wrote',
            {
                pullRequests: [supersededPullRequest()],
                comments: [
                    supersessionReceipt(99, {
                        authorNodeId: 'U_drive-by',
                        authorLogin: 'drive-by',
                        authorType: 'User',
                    }),
                ],
            },
            /closed without a supersession receipt/,
        ],
        [
            'closed carrying a receipt from a different installed app',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99, { authorNodeId: 'BOT_other', authorLogin: 'other-app[bot]' })],
            },
            /closed without a supersession receipt/,
        ],
        [
            'closed carrying a receipt written by a human impersonating the bot login',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99, { authorType: 'User' })],
            },
            /closed without a supersession receipt/,
        ],
        [
            'closed carrying two receipts that disagree',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99), supersessionReceipt(100)],
            },
            /closed without a supersession receipt/,
        ],
        [
            'superseded by a pull request that never merged',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99)],
                replacement: { state: 'CLOSED', mergedAt: null },
            },
            /superseded by #99, which is not merged/,
        ],
        [
            'superseded by a pull request whose merge is unrecorded',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99)],
                replacement: { state: 'MERGED', mergedAt: null },
            },
            /superseded by #99, which is not merged/,
        ],
        [
            'superseded by a different pull request than the one GitHub answered with',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(99)],
                replacement: { number: 98 },
            },
            /superseded by #99, which is not merged/,
        ],
        [
            'closed naming itself as its own replacement',
            {
                pullRequests: [supersededPullRequest()],
                comments: [supersessionReceipt(42)],
            },
            /names itself as its replacement/,
        ],
    ])('refuses to remove a lane %s', (_case, input, message) => {
        const { port, calls } = fakePort(input);

        let thrown: unknown;
        try {
            removeLane(target, port);
        } catch (error) {
            thrown = error;
        }

        expect(calls, 'a lane holding unmerged work was removed and the work discarded').not.toContainEqual(
            expect.stringMatching(/^remove:/)
        );
        expect(String(thrown)).toMatch(message);
    });

    /**
     * A supersession receipt says the work moved, not that the lane is finished. Everything a
     * merged lane must still prove — clean tree, idle, own head — has to hold on this path too.
     */
    it('holds a superseded lane to every other removal condition', () => {
        const { port, calls } = fakePort({
            pullRequests: [supersededPullRequest()],
            comments: [supersessionReceipt(99)],
            dirty: true,
        });

        expect(() => removeLane(target, port)).toThrow(/dirty/);
        expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
    });

    it('recovers only its own stale PID lock', () => {
        const { port, calls } = fakePort({
            lane: worktree({ locked: true, lockReason: 'lane-remove:2147483647' }),
            alive: false,
        });

        removeLane(target, port);

        expect(calls).toEqual(['fetch', `unlock:${target}`, `lock:${target}`, `unlock:${target}`, `remove:${target}`]);
    });

    it('removes an author-locked lane without dropping the lock on failure', () => {
        const { port, calls } = fakePort({
            lane: worktree({ locked: true, lockReason: 'active:sourdaw-author' }),
            dirty: true,
        });

        expect(() => removeLane(target, port)).toThrow(/dirty/);
        expect(calls).toEqual(['fetch']);
        expect(calls.some((call) => call.startsWith('unlock:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
    });

    it('unlocks an author lock only after successful removal', () => {
        const { port, calls } = fakePort({
            lane: worktree({ locked: true, lockReason: 'active:sourdaw-author' }),
        });

        removeLane(target, port);

        expect(calls).toEqual(['fetch', `unlock:${target}`, `remove:${target}`]);
    });
});

describe('lane stranding', () => {
    it('parses a strand target and its reason', () => {
        expect(parseStrandArgs(['--strand', target, '--reason', 'head was force-pushed after close'])).toEqual({
            target,
            reason: 'head was force-pushed after close',
        });
    });

    it.each([
        ['no reason at all', ['--strand', target]],
        ['a reason flag without text', ['--strand', target, '--reason']],
        ['an option where the target belongs', ['--strand', '--reason', 'why']],
        ['a blank reason', ['--strand', target, '--reason', '   ']],
    ])('refuses %s', (_case, args) => {
        expect(() => parseStrandArgs(args)).toThrow(/usage: pnpm lane:strand|non-empty --reason/);
    });

    /**
     * The stranded backlog this path exists for: a pull request GitHub reports closed with no
     * supersession receipt, which the strict gate must keep refusing. Stranding takes it with a
     * receipt naming the branch and head, so the force-deleted tip stays recoverable.
     */
    it('strands a lane the strict gate refuses, receipting before it destroys', () => {
        const strandedInput = {
            pullRequests: [supersededPullRequest()],
            comments: [],
        };
        const strict = fakeStrandPort(strandedInput);
        expect(() => removeLane(target, strict.port), 'the strict gate grew a hole').toThrow(
            /closed without a supersession receipt/
        );

        const { port, calls, receipts } = fakeStrandPort(strandedInput);
        let thrown: unknown;
        try {
            strandLane(target, 'branch was force-pushed after close; ownership unproven', port);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeUndefined();
        expect(calls).toEqual([
            'fetch',
            `lock:${target}`,
            'receipt:feature',
            `unlock:${target}`,
            `remove:${target}`,
            'branch:-D:feat/work',
            'log:stranded feature; receipt in .agents/lane-strands/feature.json',
        ]);
        const receipt = JSON.parse(receipts[0]?.body ?? '{}') as {
            lane: string;
            path: string;
            branch: string;
            head: string;
            reason: string;
            strandedAt: string;
        };
        expect(receipt).toMatchObject({
            lane: 'feature',
            path: target,
            branch: 'feat/work',
            head: 'head',
            reason: 'branch was force-pushed after close; ownership unproven',
        });
        expect(Number.isNaN(Date.parse(receipt.strandedAt))).toBe(false);
    });

    it('strands a branchless lane without querying pull requests and without deleting a branch', () => {
        const { port, calls, receipts } = fakeStrandPort({
            lane: worktree({ branch: undefined, detached: true }),
        });
        port.pullRequests = () => {
            throw new Error('a branchless lane has no pull requests to query');
        };

        strandLane(target, 'worktree left detached with no branch', port);

        const receipt = JSON.parse(receipts[0]?.body ?? '{}') as { branch: string | null };
        expect(receipt.branch).toBeNull();
        expect(calls).toContain(`remove:${target}`);
        expect(calls.some((call) => call.startsWith('branch:-D:'))).toBe(false);
    });

    /**
     * Lane directory names are deterministic, so a second lane can reuse a name the receipts
     * already record. Overwriting that receipt would erase the first abandonment's audit record
     * and the head that keeps its branch recoverable, so a differing head must refuse.
     */
    it('refuses a reused lane name whose receipt records a different head, keeping the first record', () => {
        const strandedInput = {
            pullRequests: [supersededPullRequest()],
            comments: [],
        };
        const first = fakeStrandPort(strandedInput);
        strandLane(target, 'first abandonment', first.port);
        const firstReceipt = first.receiptFiles.get('feature');
        expect(firstReceipt).toBeDefined();

        const second = fakeStrandPort({
            ...strandedInput,
            lane: worktree({ head: 'other-head' }),
        });
        second.receiptFiles.set('feature', firstReceipt ?? '');

        expect(() => strandLane(target, 'second abandonment under a spent name', second.port)).toThrow(
            'strand receipt for feature already records head head; refusing to overwrite it for head other-head'
        );

        expect(second.receiptFiles.get('feature'), "the first abandonment's record was overwritten").toBe(firstReceipt);
        expect(second.calls.some((call) => call.startsWith('receipt:'))).toBe(false);
        expect(second.calls.some((call) => call.startsWith('remove:'))).toBe(false);
        expect(second.calls.some((call) => call.startsWith('branch:-D:'))).toBe(false);
    });

    it('refuses a reused lane name whose receipt is unreadable, rather than guess at it', () => {
        const { port, receiptFiles } = fakeStrandPort({
            pullRequests: [supersededPullRequest()],
            comments: [],
        });
        receiptFiles.set('feature', 'corrupted receipt');

        expect(() => strandLane(target, 'attempt', port)).toThrow(/records no readable head/);
        expect(receiptFiles.get('feature')).toBe('corrupted receipt');
    });

    /**
     * The receipt is written before the worktree is removed, so a removal that fails leaves the
     * lane and its receipt behind. Retrying the same strand — same head — must succeed rather than
     * trip the conflict rule, or the receipt would shield its own lane from ever leaving.
     */
    it('allows the idempotent retry of a stranding whose removal failed', () => {
        const strand = fakeStrandPort({
            pullRequests: [supersededPullRequest()],
            comments: [],
        });
        let removalFails = true;
        const originalRemove = strand.port.remove;
        strand.port.remove = (path) => {
            if (removalFails) {
                throw new Error('worktree remove failed');
            }
            originalRemove(path);
        };

        expect(() => strandLane(target, 'retry after a failed removal', strand.port)).toThrow(/worktree remove failed/);
        expect(strand.receiptFiles.get('feature')).toBeDefined();

        removalFails = false;
        let thrown: unknown;
        try {
            strandLane(target, 'retry after a failed removal', strand.port);
        } catch (error) {
            thrown = error;
        }

        expect(thrown, 'a same-head retry was refused by its own receipt').toBeUndefined();
        expect(strand.calls.filter((call) => call.startsWith('receipt:'))).toHaveLength(2);
        expect(strand.calls).toContain(`remove:${target}`);
        expect(strand.calls).toContain('branch:-D:feat/work');
    });

    it.each([
        ['dirty', { dirty: true }, /dirty/],
        [
            'holding an open pull request',
            { pullRequests: [pullRequest({ state: 'OPEN', mergedAt: null })] },
            /still active/,
        ],
        [
            'holding an open draft pull request',
            { pullRequests: [pullRequest({ state: 'OPEN', mergedAt: null, isDraft: true })] },
            /still active/,
        ],
        ['carrying ignored data of record', { ignored: ['.env'] }, /ignored data/],
        ['busy in another process', { active: true }, /active in another process/],
    ])('refuses to strand a lane %s', (_case, input, message) => {
        const { port, calls, receipts } = fakeStrandPort(input);

        expect(() => strandLane(target, 'attempt', port)).toThrow(message);
        expect(receipts, 'a refused strand still destroyed or receipted the lane').toEqual([]);
        expect(calls.some((call) => call.startsWith('remove:'))).toBe(false);
        expect(calls.some((call) => call.startsWith('branch:-D:'))).toBe(false);
    });

    it('refuses the primary checkout', () => {
        const { port } = fakeStrandPort();

        expect(() => strandLane(root, 'attempt', port)).toThrow(/primary/);
    });

    /**
     * An author-locked lane holds a share of the shared author lock; a failed strand must not
     * release it, exactly as a failed removal does not.
     */
    it('holds an author-locked lane to the strand conditions without dropping the lock on failure', () => {
        const { port, calls } = fakeStrandPort({
            lane: worktree({ locked: true, lockReason: 'active:sourdaw-author' }),
            dirty: true,
        });

        expect(() => strandLane(target, 'attempt', port)).toThrow(/dirty/);
        expect(calls).toEqual(['fetch']);
    });

    it('receipts and strands a real worktree the strict gate refuses', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-strand-'));
        const lane = join(repository, '.agents/worktrees/feature');
        const git = (args: string[], cwd = repository) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
        try {
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            writeFileSync(join(repository, '.gitignore'), 'node_modules/\n.env\n');
            writeFileSync(join(repository, 'tracked.txt'), 'fixture\n');
            git(['add', '.']);
            git(['commit', '-m', 'fixture']);
            mkdirSync(join(repository, '.agents/worktrees'), { recursive: true });
            git(['worktree', 'add', lane, '-b', 'feat/work']);
            git(['worktree', 'lock', '--reason', 'active:sourdaw-author', lane]);
            const head = git(['rev-parse', 'HEAD'], lane);
            const resolvedLane = realpathSync(lane);
            const port: LaneStrandPort = {
                fetch: () => undefined,
                repository: () => 'jcosta33/sourdaw',
                currentDirectory: () => repository,
                worktrees: () => parseWorktrees(git(['worktree', 'list', '--porcelain', '-z'])),
                active: () => false,
                processAlive: () => true,
                dirty: (path) => git(['status', '--porcelain=v1', '--untracked-files=all'], path) !== '',
                ignored: () => [],
                operation: () => undefined,
                remoteHead: () => undefined,
                pullRequests: () => [pullRequest({ headRefOid: head, state: 'CLOSED', mergedAt: null })],
                comments: () => [],
                replacement: (number) => ({ number, state: 'MERGED', mergedAt: '2026-08-20T00:00:00Z' }),
                lock: (path) => {
                    git(['worktree', 'lock', '--reason', 'test', path]);
                },
                unlock: (path) => {
                    git(['worktree', 'unlock', path]);
                },
                remove: (path) => {
                    git(['worktree', 'remove', path]);
                },
                readReceipt: () => undefined,
                writeReceipt: (laneName, body) => {
                    const directory = join(repository, STRAND_RECEIPTS_DIR);
                    mkdirSync(directory, { recursive: true });
                    writeFileSync(join(directory, `${laneName}.json`), body);
                },
                deleteBranch: (branch) => {
                    git(['branch', '-D', branch]);
                },
                log: () => undefined,
            };

            expect(() => removeLane(resolvedLane, port), 'the strict gate must keep refusing this lane').toThrow(
                /closed without a supersession receipt/
            );

            strandLane(resolvedLane, 'branch was force-pushed after close; ownership unproven', port);

            expect(existsSync(lane)).toBe(false);
            expect(git(['branch', '--list', 'feat/work'])).toBe('');
            const receiptPath = join(repository, STRAND_RECEIPTS_DIR, 'feature.json');
            expect(existsSync(receiptPath)).toBe(true);
            const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as { head: string; branch: string };
            expect(receipt.head).toBe(head);
            expect(receipt.branch).toBe('feat/work');
            // The recorded head is the recovery path for the force-deleted branch.
            expect(git(['rev-parse', `${receipt.head}^{commit}`])).toBe(head);
            git(['branch', 'revived', receipt.head]);
            expect(git(['rev-parse', 'refs/heads/revived'])).toBe(head);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });
});

describe('lane path resolution', () => {
    it('resolves relative lane paths from the primary root', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-target-'));
        try {
            const lane = join(repository, '.agents/worktrees/feature');
            mkdirSync(lane, { recursive: true });
            expect(resolveLaneTarget('.agents/worktrees/feature', repository)).toBe(realpathSync(lane));
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });
});

describe('worktree parser', () => {
    it('preserves locked, detached, and branch state from porcelain output', () => {
        const value = [
            'worktree /repo\0HEAD root\0branch refs/heads/main',
            'worktree /repo/.agents/worktrees/feature\0HEAD head\0detached\0locked shared',
        ].join('\0\0');

        expect(parseWorktrees(`${value}\0\0`)).toEqual([
            worktree({ path: root, head: 'root', branch: 'main' }),
            worktree({ branch: undefined, detached: true, locked: true, lockReason: 'shared' }),
        ]);
    });
});

describe('lane-removal shell boundary', () => {
    it('recognizes an active lsof cwd through an alias', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-active-alias-'));
        const aliasParent = mkdtempSync(join(tmpdir(), 'sourdaw-lane-active-alias-link-'));
        const alias = join(aliasParent, 'repository');
        const lane = join(repository, '.agents/worktrees/feature');
        try {
            mkdirSync(lane, { recursive: true });
            symlinkSync(repository, alias, 'dir');
            const port = shellPort({
                capture: (command) => {
                    if (command !== 'lsof') {
                        throw new Error(`unexpected capture: ${command}`);
                    }
                    return `p999999\nfcwd\nn${join(alias, '.agents/worktrees/feature')}`;
                },
                run: () => undefined,
            });

            expect(port.active(realpathSync(lane))).toBe(true);
        } finally {
            rmSync(aliasParent, { recursive: true, force: true });
            rmSync(repository, { recursive: true, force: true });
        }
    });

    it('paginates exact-repository ownership and uses native lock and removal commands', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const runs: Array<{ command: string; args: string[] }> = [];
        const shell: ShellRunner = {
            capture: (command, args) => {
                captures.push({ command, args });
                if (command === 'lsof') {
                    return `p999\nfcwd\nn${target}`;
                }
                if (args.includes('nameWithOwner')) {
                    return 'jcosta33/sourdaw';
                }
                if (args.includes('--slurp')) {
                    return JSON.stringify([
                        [
                            {
                                number: 42,
                                state: 'closed',
                                draft: false,
                                head: {
                                    ref: 'feat/work',
                                    sha: 'head',
                                    repo: { full_name: 'jcosta33/sourdaw' },
                                },
                                merged_at: '2026-08-12T00:00:00Z',
                            },
                        ],
                    ]);
                }
                if (args[0] === 'for-each-ref') {
                    return '';
                }
                throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
            },
            run: (command, args) => runs.push({ command, args }),
        };
        const port = shellPort(shell);

        expect(port.pullRequests('feat/work')).toEqual([pullRequest()]);
        expect(port.remoteHead('feat/work')).toBeUndefined();
        expect(port.active(target)).toBe(true);
        port.lock(target);
        port.unlock(target);
        port.remove(target);

        expect(
            captures.some(
                (entry) => entry.command === 'gh' && entry.args.includes('--paginate') && entry.args.includes('--slurp')
            )
        ).toBe(true);
        expect(runs.map((entry) => entry.args.slice(0, 2))).toEqual([
            ['worktree', 'lock'],
            ['worktree', 'unlock'],
            ['worktree', 'remove'],
        ]);
        expect(runs.at(-1)).toEqual({ command: 'git', args: ['worktree', 'remove', target] });
    });

    it('reads the supersession receipt and the replacement from paginated GitHub state', () => {
        const captures: Array<{ command: string; args: string[] }> = [];
        const shell: ShellRunner = {
            capture: (command, args) => {
                captures.push({ command, args });
                if (args.includes('nameWithOwner')) {
                    return 'jcosta33/sourdaw';
                }
                if (args.includes('repos/jcosta33/sourdaw/issues/42/comments?per_page=100')) {
                    return JSON.stringify([
                        [
                            {
                                body: 'Superseded by #99.',
                                user: { node_id: AUTHOR_BOT_NODE_ID, login: 'renamed-author[bot]', type: 'Bot' },
                            },
                        ],
                        [{ body: 'drive by', user: null }],
                    ]);
                }
                if (args.includes('repos/jcosta33/sourdaw/pulls/99')) {
                    return JSON.stringify({ number: 99, state: 'closed', merged_at: '2026-08-20T00:00:00Z' });
                }
                throw new Error(`unexpected capture: ${command} ${args.join(' ')}`);
            },
            run: () => undefined,
        };
        const port = shellPort(shell);

        expect(port.comments(42)).toEqual([
            {
                body: 'Superseded by #99.',
                authorNodeId: AUTHOR_BOT_NODE_ID,
                authorLogin: 'renamed-author[bot]',
                authorType: 'Bot',
            },
            { body: 'drive by', authorNodeId: null, authorLogin: null, authorType: null },
        ]);
        // GitHub reports a merged pull request as `closed`; only `merged_at` says it landed.
        expect(port.replacement(99)).toEqual({ number: 99, state: 'MERGED', mergedAt: '2026-08-20T00:00:00Z' });
        expect(
            captures.some(
                (entry) => entry.command === 'gh' && entry.args.includes('--paginate') && entry.args.includes('--slurp')
            )
        ).toBe(true);
    });

    it('preserves ignored data and removes disposable output in a real worktree', () => {
        const repository = mkdtempSync(join(tmpdir(), 'sourdaw-lane-remove-'));
        const lane = join(repository, '.agents/worktrees/feature');
        const git = (args: string[], cwd = repository) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
        try {
            git(['init', '-b', 'main']);
            git(['config', 'user.name', 'Fixture']);
            git(['config', 'user.email', 'fixture@example.com']);
            writeFileSync(join(repository, '.gitignore'), 'node_modules/\n.env\n');
            writeFileSync(join(repository, 'tracked.txt'), 'fixture\n');
            git(['add', '.']);
            git(['commit', '-m', 'fixture']);
            mkdirSync(join(repository, '.agents/worktrees'), { recursive: true });
            git(['worktree', 'add', lane, '-b', 'feat/work']);
            const head = git(['rev-parse', 'HEAD'], lane);
            const resolvedLane = realpathSync(lane);
            const port: LaneRemovalPort = {
                fetch: () => undefined,
                repository: () => 'jcosta33/sourdaw',
                currentDirectory: () => repository,
                worktrees: () => parseWorktrees(git(['worktree', 'list', '--porcelain', '-z'])),
                active: () => false,
                processAlive: () => true,
                dirty: (path) => git(['status', '--porcelain=v1', '--untracked-files=all'], path) !== '',
                ignored: (path) =>
                    git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory'], path)
                        .split('\n')
                        .filter((candidate) => candidate !== ''),
                operation: () => undefined,
                remoteHead: () => undefined,
                pullRequests: () => [pullRequest({ headRefOid: head })],
                comments: () => [],
                replacement: (number) => ({ number, state: 'MERGED', mergedAt: '2026-08-20T00:00:00Z' }),
                lock: (path) => {
                    git(['worktree', 'lock', '--reason', 'test', path]);
                },
                unlock: (path) => {
                    git(['worktree', 'unlock', path]);
                },
                remove: (path) => {
                    git(['worktree', 'remove', path]);
                },
            };

            writeFileSync(join(lane, '.env'), 'SECRET=keep\n');
            expect(() => removeLane(resolvedLane, port)).toThrow(/ignored data: .env/);
            expect(existsSync(lane)).toBe(true);

            rmSync(join(lane, '.env'));
            mkdirSync(join(lane, 'node_modules'), { recursive: true });
            writeFileSync(join(lane, 'node_modules/cache'), 'generated\n');
            removeLane(resolvedLane, port);
            expect(existsSync(lane)).toBe(false);
        } finally {
            rmSync(repository, { recursive: true, force: true });
        }
    });
});
