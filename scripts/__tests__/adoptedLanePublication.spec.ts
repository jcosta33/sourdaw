import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    AUTHOR_BOT_COMMIT_EMAIL,
    AUTHOR_BOT_COMMIT_NAME,
    AUTHOR_BOT_NODE_ID,
    AUTHOR_LOCK_REASON,
    REQUIRED_REPOSITORY,
} from '../githubAppIdentity.ts';
import {
    composePublishBody,
    readLaneAdoptionRecord,
    saveLaneAdoptionRecord,
    type AdoptedPullRequest,
    type LaneAdoption,
    type LaneAdoptionIntent,
} from '../prContract.ts';
import { prepareAdoptedPublication, publishLane, type PublishLanePort } from '../publishLane.ts';

const OLD = 'a'.repeat(40);
const HEAD = 'c'.repeat(40);
const BASE = 'b'.repeat(40);
const FOREIGN = 'd'.repeat(40);
const MODEL = 'gpt-6.1-sol';
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'adopted-publication-'));
    roots.push(root);
    const lane = join(root, 'lane');
    mkdirSync(lane);
    const pr: AdoptedPullRequest = {
        number: 12,
        id: 'PR_original',
        repository: REQUIRED_REPOSITORY,
        authorId: AUTHOR_BOT_NODE_ID,
        branch: 'feat/12/example',
        base: 'agent/20/parent',
        baseHead: BASE,
        head: OLD,
    };
    const adoption: LaneAdoption = {
        version: 1,
        kind: 'present-pr-custody',
        pullRequest: pr,
        lanePath: lane,
        model: MODEL,
        sourceCommit: BASE,
        nonce: '12345678-1234-1234-1234-123456789abc',
        createdAt: '2026-10-30T15:00:00.000Z',
    };
    saveLaneAdoptionRecord(root, pr.branch, adoption);
    let remote = OLD;
    let source = HEAD;
    let publicPr = { ...pr };
    let exists = true;
    const effects: string[] = [];
    const body = composePublishBody(
        12,
        'feat: preserve original work',
        'Preserve the original change.',
        'Open the tool and inspect the resulting change.'
    );
    const port: PublishLanePort = {
        baseSha: () => BASE,
        worktrees: () => [{ path: lane, branch: pr.branch, locked: true, lockReason: AUTHOR_LOCK_REASON }],
        cwd: () => lane,
        issueExists: () => true,
        aheadBehind: () => ({ ahead: 2, behind: 0 }),
        dirty: () => false,
        laneSubject: () => 'feat: retain parent history',
        commitAuthorEmails: () => [{ sha: HEAD, email: AUTHOR_BOT_COMMIT_EMAIL }],
        objectStoreRewrites: () => ({ replaceRefs: 0 }),
        headSha: () => source,
        remoteBranchSha: () => ({ kind: 'present', sha: remote }),
        isAncestor: () => true,
        push: (_path, _branch, head) => {
            effects.push('push');
            remote = head;
            publicPr = { ...publicPr, head };
        },
        existingOpenPullRequest: () =>
            exists
                ? {
                      number: publicPr.number,
                      title: 'feat: preserve original work',
                      body,
                      baseRefName: publicPr.base,
                      headRefOid: publicPr.head,
                  }
                : undefined,
        adoptionRecord: (branch) => readLaneAdoptionRecord(root, branch),
        adoptionIntent: (branch) => readLaneAdoptionRecord(root, branch, true),
        saveAdoptionIntent: (branch, intent) => {
            effects.push('intent');
            saveLaneAdoptionRecord(root, branch, intent);
        },
        observeAdoption: () => ({ ...publicPr }),
        readPullRequestMergeability: () => 'mergeable',
        conflictingPaths: () => [],
        changedPaths: () => [],
        createPullRequest: () => {
            effects.push('CREATE');
            return 99;
        },
        updatePullRequest: (number) => {
            effects.push(`edit:${number}`);
        },
        saveAuthorModel: () => undefined,
        readAuthorModel: () => MODEL,
        ensureModelLabel: () => {
            effects.push('label');
        },
        readIssueTrackerMetadata: () => ({ labels: [] }),
        openMilestoneTitles: () => [],
        knownProjectTitles: () => [],
        readIssueProjectTitles: () => [],
        knownLabels: () => [],
        readPullRequestMetadata: () => ({ labels: [MODEL], fencedAuthorLabels: [MODEL] }),
        readPullRequestProjectTitles: () => [],
        applyPullRequestMetadata: () => {
            effects.push('metadata');
        },
        log: () => undefined,
        guardFailure: () => undefined,
    };
    return {
        root,
        lane,
        pr,
        adoption,
        port,
        effects,
        setRemote: (value: string) => {
            remote = value;
            publicPr = { ...publicPr, head: value };
        },
        setHead: (value: string) => {
            source = value;
        },
        setPublic: (value: Partial<AdoptedPullRequest>) => {
            publicPr = { ...publicPr, ...value };
        },
        disappear: () => {
            exists = false;
        },
    };
}

describe('one successor of the exact adopted PR', () => {
    it('publishes only the original PR while preserving its base and retains a strict immutable intent', () => {
        const f = fixture();
        expect(publishLane(12, f.port)).toBe(12);
        expect(f.effects).toEqual(['intent', 'push', 'label', 'edit:12']);
        expect(readLaneAdoptionRecord(f.root, f.pr.branch, true)).toEqual({
            version: 1,
            kind: 'present-pr-publication',
            nonce: f.adoption.nonce,
            oldHead: OLD,
            head: HEAD,
        });
        const raw = JSON.stringify(readLaneAdoptionRecord(f.root, f.pr.branch));
        f.effects.length = 0;
        expect(publishLane(12, f.port)).toBe(12);
        expect(f.effects).toEqual(['label', 'edit:12']);
        expect(JSON.stringify(readLaneAdoptionRecord(f.root, f.pr.branch))).toBe(raw);
    });
    it('keeps ordinary publication independent of custody records and the new inspection API', () => {
        const f = fixture();
        f.port.adoptionRecord = () => undefined;
        f.port.adoptionIntent = () => undefined;
        f.port.observeAdoption = () => {
            throw new Error('ordinary publication must never observe adoption');
        };
        expect(publishLane(12, f.port)).toBe(12);
        expect(f.effects).toEqual(['push', 'label', 'edit:12']);
    });
    it.each([
        { id: 'PR_reused' },
        { number: 88 },
        { repository: 'foreign/repo' },
        { authorId: 'BOT_foreign' },
        { base: 'main' },
        { baseHead: FOREIGN },
        { branch: 'feat/12/foreign' },
    ])('refuses public identity/base substitution %j before all writes', (change) => {
        const f = fixture();
        f.setPublic(change);
        expect(() => publishLane(12, f.port)).toThrow('changed');
        expect(f.effects).toEqual([]);
    });
    it('refuses disappearance instead of creating any replacement PR', () => {
        const f = fixture();
        f.disappear();
        expect(() => publishLane(12, f.port)).toThrow('create fallback');
        expect(f.effects).toEqual([]);
    });
    it('refuses disagreement between GitHub head and the actual remote before writes', () => {
        const f = fixture();
        f.setPublic({ head: FOREIGN });
        expect(() => publishLane(12, f.port)).toThrow('head changed');
        expect(f.effects).toEqual([]);
    });
    it('rejects an arbitrary descendant even when the ordinary fast-forward oracle says yes', () => {
        const f = fixture();
        f.setRemote(FOREIGN);
        expect(() => publishLane(12, f.port)).toThrow('frozen source');
        expect(f.effects).toEqual([]);
    });
    it('requires real original ancestry and refuses object-store replacements before traversal', () => {
        const f = fixture();
        f.port.isAncestor = () => false;
        expect(() => publishLane(12, f.port)).toThrow('retain the original');
        expect(f.effects).toEqual([]);
        const g = fixture();
        g.port.objectStoreRewrites = () => ({ replaceRefs: 1 });
        g.port.isAncestor = () => {
            throw new Error('traversal must not run');
        };
        expect(() => publishLane(12, g.port)).toThrow('rewritten object history');
        expect(g.effects).toEqual([]);
    });
    it('never excludes inherited noncanonical commits from the existing author gate', () => {
        const f = fixture();
        f.port.commitAuthorEmails = (_path, delta, excluded) => {
            expect(delta).toBe(OLD);
            expect(excluded).toEqual([BASE]);
            return [{ sha: HEAD, email: 'foreign@example.invalid' }];
        };
        expect(() => publishLane(12, f.port)).toThrow('foreign@example.invalid');
        expect(f.effects).toEqual([]);
    });
    it.each(['intent', 'push', 'label', 'edit'])(
        'stops at %s interruption and permits only the exact frozen successor replay',
        (phase) => {
            const f = fixture();
            if (phase === 'intent') {
                const original = f.port.saveAdoptionIntent!;
                f.port.saveAdoptionIntent = (branch, intent) => {
                    original(branch, intent);
                    throw new Error('interrupted');
                };
            }
            if (phase === 'push') {
                const original = f.port.push;
                f.port.push = (...args) => {
                    original(...args);
                    throw new Error('interrupted');
                };
            }
            if (phase === 'label') {
                f.port.ensureModelLabel = () => {
                    throw new Error('interrupted');
                };
            }
            if (phase === 'edit') {
                f.port.updatePullRequest = () => {
                    throw new Error('interrupted');
                };
            }
            expect(() => publishLane(12, f.port)).toThrow(phase === 'intent' ? 'interrupted' : 'may be partial');
            expect(readLaneAdoptionRecord(f.root, f.pr.branch, true)?.head).toBe(HEAD);
            f.setHead(FOREIGN);
            expect(() => publishLane(12, f.port)).toThrow('different successor');
            f.setHead(HEAD);
            const prepared = prepareAdoptedPublication({ path: f.lane, branch: f.pr.branch }, HEAD, f.port);
            expect(prepared).toBeDefined();
        }
    );
    it('checks identity at every write boundary and reports post-write movement as partial', () => {
        const f = fixture();
        const original = f.port.push;
        f.port.push = (...args) => {
            original(...args);
            f.setPublic({ id: 'PR_reused' });
        };
        expect(() => publishLane(12, f.port)).toThrow('may be partial');
        expect(f.effects).toEqual(['intent', 'push']);
        const g = fixture();
        const save = g.port.saveAdoptionIntent!;
        g.port.saveAdoptionIntent = (branch, intent) => {
            save(branch, intent);
            g.disappear();
        };
        expect(() => publishLane(12, g.port)).toThrow('create fallback');
        expect(g.effects).toEqual(['intent']);
    });
    it('refuses a second intended successor and foreign worktree ownership', () => {
        const f = fixture();
        publishLane(12, f.port);
        f.effects.length = 0;
        f.setHead(FOREIGN);
        expect(() => publishLane(12, f.port)).toThrow('different successor');
        expect(f.effects).toEqual([]);
        const g = fixture();
        g.port.worktrees = () => [{ path: g.lane, branch: g.pr.branch, locked: true, lockReason: 'foreign' }];
        expect(() => prepareAdoptedPublication({ path: g.lane, branch: g.pr.branch }, HEAD, g.port)).toThrow(
            'ownership'
        );
    });
    it('rejects orphaned intent rather than silently using ordinary publication', () => {
        const f = fixture();
        f.port.adoptionRecord = () => undefined;
        const intent: LaneAdoptionIntent = {
            version: 1,
            kind: 'present-pr-publication',
            nonce: f.adoption.nonce,
            oldHead: OLD,
            head: HEAD,
        };
        f.port.adoptionIntent = () => intent;
        expect(() => publishLane(12, f.port)).toThrow('orphaned');
        expect(f.effects).toEqual([]);
    });
});

describe('immutable ancestry from actual additive history', () => {
    it('retains the old child, adds the final parent and real landed squash without changing either original ref', () => {
        const root = mkdtempSync(join(tmpdir(), 'adopted-ancestry-'));
        roots.push(root);
        const git = (...args: string[]) =>
            execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        const ancestor = (a: string, b: string) => {
            try {
                git('merge-base', '--is-ancestor', a, b);
                return true;
            } catch {
                return false;
            }
        };
        git('init', '-b', 'main');
        git('config', 'user.name', AUTHOR_BOT_COMMIT_NAME);
        git('config', 'user.email', AUTHOR_BOT_COMMIT_EMAIL);
        writeFileSync(join(root, 'base'), 'base');
        git('add', '.');
        git('commit', '-m', 'feat: base');
        git('checkout', '-b', 'parent');
        writeFileSync(join(root, 'parent'), 'one');
        git('add', '.');
        git('commit', '-m', 'feat: parent one');
        git('checkout', '-b', 'child');
        writeFileSync(join(root, 'child'), 'child');
        git('add', '.');
        git('commit', '-m', 'feat: child');
        const old = git('rev-parse', 'HEAD');
        git('checkout', 'parent');
        writeFileSync(join(root, 'parent'), 'two');
        git('add', '.');
        git('commit', '-m', 'fix: parent final');
        const final = git('rev-parse', 'HEAD');
        git('checkout', 'main');
        git('merge', '--squash', 'parent');
        git('commit', '-m', 'feat: actual landed parent replacement');
        const squash = git('rev-parse', 'HEAD');
        expect(ancestor(final, old)).toBe(false);
        expect(ancestor(squash, old)).toBe(false);
        git('checkout', '-b', 'adopted', old);
        git('merge', '--no-edit', final);
        git('merge', '--no-edit', squash);
        const updated = git('rev-parse', 'HEAD');
        expect(ancestor(old, updated)).toBe(true);
        expect(ancestor(final, updated)).toBe(true);
        expect(ancestor(squash, updated)).toBe(true);
        expect(git('rev-parse', 'child')).toBe(old);
        expect(git('rev-parse', 'parent')).toBe(final);
        expect(readFileSync(join(root, 'parent'), 'utf8')).toBe('two');
        expect(
            git('log', '--format=%ae', `${old}..${updated}`, '--not', 'main')
                .split('\n')
                .every((email) => email === AUTHOR_BOT_COMMIT_EMAIL)
        ).toBe(true);
    });
});
