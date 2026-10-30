import { execFileSync, spawnSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
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
import { parseOpenLaneArgs } from '../openLane.ts';
import {
    adoptPresentPullRequest,
    verifyAdoptionSources,
    type AdoptionPort,
    type AdoptionWorktree,
    assertAdoptedPullRequest,
    assertNoAdoptionGuardFailure,
    laneAdoptionPath,
    observeAdoptedPullRequest,
    parseLaneAdoption,
    readLaneAdoptionRecord,
    saveLaneAdoptionRecord,
    type AdoptedPullRequest,
    type LaneAdoption,
} from '../prContract.ts';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const NEXT = 'c'.repeat(40);
const NONCE = '12345678-1234-1234-1234-123456789abc';
const MODEL = 'gpt-6.1-sol';
const PR: AdoptedPullRequest = {
    number: 12,
    id: 'PR_example',
    repository: REQUIRED_REPOSITORY,
    authorId: AUTHOR_BOT_NODE_ID,
    branch: 'feat/12/example',
    base: 'main',
    baseHead: BASE,
    head: HEAD,
};
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});
function temporary(): string {
    const root = mkdtempSync(join(tmpdir(), 'lane-adoption-'));
    roots.push(root);
    return root;
}
function fakeAdoption() {
    let receipt: LaneAdoption | undefined;
    let branch = '';
    let trees: AdoptionWorktree[] = [];
    let identity = false;
    let model = '';
    let birth = false;
    const effects: string[] = [];
    const port: AdoptionPort = {
        repository: REQUIRED_REPOSITORY,
        authorId: AUTHOR_BOT_NODE_ID,
        lockReason: AUTHOR_LOCK_REASON,
        primaryRoot: '/fixture',
        sourceCommit: BASE,
        observe: () => ({ ...PR }),
        receipt: () => receipt,
        save: (record) => {
            effects.push('receipt');
            receipt = record;
        },
        assertSafe: () => undefined,
        branch: () => branch,
        birth: () => birth,
        pathExists: () => false,
        worktrees: () => trees,
        reserve: (record) => {
            effects.push('branch');
            branch = record.pullRequest.head;
            birth = true;
        },
        add: (record) => {
            effects.push('worktree');
            trees = [{ path: record.lanePath, branch: PR.branch, head: HEAD, lock: AUTHOR_LOCK_REASON }];
        },
        assertCheckout: () => undefined,
        clean: () => true,
        identity: () => identity,
        stamp: () => {
            effects.push('identity');
            identity = true;
        },
        model: () => model,
        saveModel: (_branch, value) => {
            effects.push('model');
            model = value;
        },
        now: () => '2026-10-30T15:00:00.000Z',
        nonce: () => NONCE,
        log: () => undefined,
    };
    return { port, effects, receipt: () => receipt };
}
function publicReader(overrides: Record<string, unknown> = {}) {
    const core = {
        number: 12,
        node_id: PR.id,
        state: 'open',
        merged_at: null,
        user: { node_id: AUTHOR_BOT_NODE_ID, type: 'Bot' },
        head: { ref: PR.branch, sha: HEAD, repo: { full_name: REQUIRED_REPOSITORY } },
        base: { ref: 'main', repo: { full_name: REQUIRED_REPOSITORY } },
        ...overrides,
    };
    const calls: string[][] = [];
    const read = (args: string[]) => {
        calls.push(args);
        const route = args.at(-1) ?? '';
        if (route.includes('?state=all')) {
            return JSON.stringify([[core]]);
        }
        if (route.includes('/git/ref/heads/')) {
            const branch = route.split('/git/ref/heads/')[1];
            return JSON.stringify({
                ref: `refs/heads/${branch}`,
                object: { type: 'commit', sha: branch === PR.branch ? HEAD : BASE },
            });
        }
        return JSON.stringify(core);
    };
    return { calls, read };
}

describe('explicit present PR custody', () => {
    it('requires the paired immutable selectors and preserves ordinary parsing', () => {
        expect(parseOpenLaneArgs(['--adopt-pr', '12', '--expected-head', HEAD, '--model', MODEL])).toMatchObject({
            adoptPr: 12,
            expectedHead: HEAD,
            model: MODEL,
        });
        for (const args of [
            ['--adopt-pr', '12'],
            ['--expected-head', HEAD],
            ['--adopt-pr', '12', '--expected-head', NEXT.slice(1), '--model', MODEL],
            ['--adopt-pr', '12', '--expected-head', HEAD, '--model', MODEL, '--stack-on', '/parent'],
            ['--adopt-pr', '12', '--expected-head', HEAD, '--model', MODEL, '--adopt-pr', '12'],
        ]) {
            expect(() => parseOpenLaneArgs(args)).toThrow();
        }
        expect(parseOpenLaneArgs(['example', '--type', 'feat', '--model', MODEL])).toMatchObject({
            slug: 'example',
            type: 'feat',
            model: MODEL,
        });
    });
    it('refuses undefined or mixed source pins before any custody/public read callback', () => {
        const reads: string[] = [];
        expect(() =>
            verifyAdoptionSources(
                ['script'],
                '',
                () => {
                    reads.push('source');
                    return 'code';
                },
                () => 'code'
            )
        ).toThrow('defined');
        expect(reads).toEqual([]);
        expect(() =>
            verifyAdoptionSources(
                ['script'],
                BASE,
                () => undefined,
                () => 'code'
            )
        ).toThrow('unavailable');
        expect(() =>
            verifyAdoptionSources(
                ['script'],
                BASE,
                () => 'old',
                () => 'new'
            )
        ).toThrow('changed');
        verifyAdoptionSources(
            ['one', 'two'],
            BASE,
            (_path, pin) => {
                expect(pin).toBe(BASE);
                return 'code';
            },
            () => 'code'
        );
    });
    it('records only present custody and completed replay has no local effects', () => {
        const f = fakeAdoption();
        const path = adoptPresentPullRequest(12, HEAD, MODEL, f.port);
        expect(f.effects).toEqual(['receipt', 'branch', 'worktree', 'identity', 'model']);
        expect(path).toBe('/fixture/.agents/worktrees/adopt-12-aaaaaaaaaaaa');
        expect(f.receipt()?.kind).toBe('present-pr-custody');
        f.effects.length = 0;
        expect(adoptPresentPullRequest(12, HEAD, MODEL, f.port)).toBe(path);
        expect(f.effects).toEqual([]);
    });
    it.each(['receipt', 'branch', 'worktree', 'identity', 'model'])(
        'retains matching interruptions after %s and replays forward only',
        (phase) => {
            const f = fakeAdoption();
            const key = { receipt: 'save', branch: 'reserve', worktree: 'add', identity: 'stamp', model: 'saveModel' }[
                phase
            ] as 'save' | 'reserve' | 'add' | 'stamp' | 'saveModel';
            const original = f.port[key];
            // The failure is injected after the real phase effect, never into production executable code.
            if (key === 'save') {
                const run = f.port.save;
                f.port.save = (record) => {
                    run(record);
                    throw new Error('interrupted');
                };
            }
            if (key === 'reserve') {
                const run = f.port.reserve;
                f.port.reserve = (record) => {
                    run(record);
                    throw new Error('interrupted');
                };
            }
            if (key === 'add') {
                const run = f.port.add;
                f.port.add = (record) => {
                    run(record);
                    throw new Error('interrupted');
                };
            }
            if (key === 'stamp') {
                const run = f.port.stamp;
                f.port.stamp = (path) => {
                    run(path);
                    throw new Error('interrupted');
                };
            }
            if (key === 'saveModel') {
                const run = f.port.saveModel;
                f.port.saveModel = (branch, model) => {
                    run(branch, model);
                    throw new Error('interrupted');
                };
            }
            expect(() => adoptPresentPullRequest(12, HEAD, MODEL, f.port)).toThrow('interrupted');
            Object.assign(f.port, { [key]: original });
            expect(() => adoptPresentPullRequest(12, HEAD, MODEL, f.port)).not.toThrow();
            expect(f.effects.filter((effect) => effect === phase)).toHaveLength(1);
            expect(() => adoptPresentPullRequest(12, NEXT, MODEL, f.port)).toThrow('expected head');
        }
    );
    it.each(['branch', 'path', 'tree', 'guard', 'stack', 'graft'])('refuses %s collision without effects', (kind) => {
        const f = fakeAdoption();
        if (kind === 'branch') {
            f.port.branch = () => HEAD;
        }
        if (kind === 'path') {
            f.port.pathExists = () => true;
        }
        if (kind === 'tree') {
            f.port.worktrees = () => [{ branch: PR.branch, path: '/foreign', head: HEAD, lock: AUTHOR_LOCK_REASON }];
        }
        if (['guard', 'stack', 'graft'].includes(kind)) {
            f.port.assertSafe = () => {
                throw new Error(kind);
            };
        }
        expect(() => adoptPresentPullRequest(12, HEAD, MODEL, f.port)).toThrow();
        expect(f.effects).toEqual([]);
    });
    it('refuses a checkout redirected after reservation before stamping any foreign identity', () => {
        const f = fakeAdoption();
        f.port.assertCheckout = () => {
            throw new Error('foreign common directory');
        };
        expect(() => adoptPresentPullRequest(12, HEAD, MODEL, f.port)).toThrow('foreign common');
        expect(f.effects).toEqual(['receipt', 'branch', 'worktree']);
    });
    it('checks movement at every phase and never overwrites a foreign branch', () => {
        for (const phase of ['receipt', 'branch', 'worktree', 'identity', 'model']) {
            const f = fakeAdoption();
            f.port.observe = () => ({ ...PR, head: f.effects.includes(phase) ? NEXT : HEAD });
            expect(() => adoptPresentPullRequest(12, HEAD, MODEL, f.port)).toThrow('changed');
            expect(f.effects.at(-1)).toBe(phase);
        }
    });
});

describe('public PR and immutable local evidence', () => {
    it('uses complete all-state candidates, independent refs and a terminal core read', () => {
        const f = publicReader();
        expect(observeAdoptedPullRequest(12, REQUIRED_REPOSITORY, AUTHOR_BOT_NODE_ID, f.read)).toEqual(PR);
        expect(f.calls[1]?.slice(0, 3)).toEqual(['api', '--paginate', '--slurp']);
        expect(f.calls[0]).toEqual(f.calls.at(-1));
    });
    it.each([
        { state: 'closed' },
        { user: { node_id: 'foreign', type: 'Bot' } },
        { head: { ref: PR.branch, sha: HEAD, repo: { full_name: 'foreign/repo' } } },
    ])('refuses foreign or closed PR %j', (override) => {
        const f = publicReader(override);
        expect(() => observeAdoptedPullRequest(12, REQUIRED_REPOSITORY, AUTHOR_BOT_NODE_ID, f.read)).toThrow();
    });
    it('refuses duplicate/truncated candidates, live-ref movement and final-core movement', () => {
        for (const mode of ['duplicate', 'truncated', 'ref', 'core']) {
            const f = publicReader();
            const read = (args: string[]) => {
                const raw = f.read(args);
                if (args.includes('--paginate')) {
                    return mode === 'duplicate'
                        ? JSON.stringify([...JSON.parse(raw), ...JSON.parse(raw)])
                        : mode === 'truncated'
                          ? '{}'
                          : raw;
                }
                if (mode === 'ref' && args.at(-1)?.endsWith(PR.branch)) {
                    return raw.replace(HEAD, NEXT);
                }
                if (mode === 'core' && f.calls.length === 5) {
                    return raw.replace(HEAD, NEXT);
                }
                return raw;
            };
            expect(() => observeAdoptedPullRequest(12, REQUIRED_REPOSITORY, AUTHOR_BOT_NODE_ID, read)).toThrow();
        }
        expect(() => assertAdoptedPullRequest({ ...PR, id: 'PR_other' }, PR, HEAD)).toThrow();
    });
    it('retains guard failures filed under any former lane name of the same branch', () => {
        const root = temporary();
        const directory = join(root, '.agents', 'guard-failures');
        mkdirSync(directory, { recursive: true });
        writeFileSync(
            join(directory, 'former-lane.json'),
            JSON.stringify({
                version: 1,
                lane: 'former-lane',
                branch: PR.branch,
                headSha: HEAD,
                failedAt: '2026-10-30T15:00:00.000Z',
                reason: 'timeout',
                command: 'pnpm',
                args: ['test:run', 'one.spec.ts'],
                profile: 'focused',
                peakRssBytes: 1,
                maxRssBytes: 2,
                durationMs: 3,
            })
        );
        expect(() => assertNoAdoptionGuardFailure(root, PR.branch)).toThrow('guard-failure evidence');
        expect(() => assertNoAdoptionGuardFailure(root, 'feat/other')).not.toThrow();
    });
    it('strictly reads atomic immutable receipts and rejects symlink/extra-field substitution', () => {
        const root = temporary();
        const f = fakeAdoption();
        adoptPresentPullRequest(12, HEAD, MODEL, f.port);
        const receipt = f.receipt()!;
        saveLaneAdoptionRecord(root, PR.branch, receipt);
        expect(readLaneAdoptionRecord(root, PR.branch)).toEqual(receipt);
        expect(() => saveLaneAdoptionRecord(root, PR.branch, receipt)).toThrow();
        expect(() => parseLaneAdoption(JSON.stringify({ ...receipt, forkHead: BASE }))).toThrow('fields');
        const second = temporary();
        mkdirSync(join(second, '.agents', 'lane-adoptions'), { recursive: true });
        symlinkSync(laneAdoptionPath(root, PR.branch), laneAdoptionPath(second, PR.branch));
        expect(() => readLaneAdoptionRecord(second, PR.branch)).toThrow();
        expect(readdirSync(join(root, '.agents', 'lane-adoptions'))).toHaveLength(1);
    });
});

function nativeFixture() {
    const root = temporary();
    const primary = join(root, 'primary');
    const remote = join(root, 'remote.git');
    const bin = join(root, 'bin');
    mkdirSync(primary);
    mkdirSync(bin);
    mkdirSync(join(primary, 'scripts'));
    mkdirSync(join(primary, '.agents'));
    const sources = [
        'openLane.ts',
        'prContract.ts',
        'githubAppIdentity.ts',
        'stackedLanes.ts',
        'laneStackForkMarkers.ts',
        'pnpmModulesPreflight.ts',
    ];
    for (const file of sources) {
        cpSync(join(process.cwd(), 'scripts', file), join(primary, 'scripts', file));
    }
    writeFileSync(join(primary, 'package.json'), '{"type":"module"}');
    writeFileSync(join(primary, '.gitignore'), '.agents/\n');
    const git = (...args: string[]) =>
        execFileSync('git', args, { cwd: primary, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-b', 'main');
    git('config', 'user.name', AUTHOR_BOT_COMMIT_NAME);
    git('config', 'user.email', AUTHOR_BOT_COMMIT_EMAIL);
    git('add', '.');
    git('commit', '-m', 'feat: baseline');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-b', PR.branch);
    writeFileSync(join(primary, 'child.txt'), 'child');
    git('add', 'child.txt');
    git('commit', '-m', 'feat: child');
    const head = git('rev-parse', 'HEAD');
    execFileSync('git', ['clone', '--bare', primary, remote], { stdio: 'pipe' });
    git('checkout', 'main');
    git('update-ref', '-d', `refs/heads/${PR.branch}`, head);
    git('remote', 'add', 'origin', remote);
    git('fetch', 'origin', 'main');
    git('config', `url.${remote}.insteadOf`, 'https://github.com/jcosta33/sourdaw.git');
    const data = join(root, 'public.json');
    writeFileSync(data, JSON.stringify({ ...PR, head, baseHead: base }));
    const gh = `#!${process.execPath}\nconst fs=require('node:fs');const p=JSON.parse(fs.readFileSync(${JSON.stringify(data)},'utf8'));const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(join(root, 'gh-calls'))},JSON.stringify(a)+'\\n');if(a[0]!=='api'){process.exit(81)}const u=a.at(-1);const c={number:p.number,node_id:p.id,state:'open',merged_at:null,user:{node_id:p.authorId,type:'Bot'},head:{ref:p.branch,sha:p.head,repo:{full_name:p.repository}},base:{ref:p.base,repo:{full_name:p.repository}}};let out=c;if(u.includes('?state=all'))out=[[c]];if(u.includes('/git/ref/heads/')){const ref=u.split('/git/ref/heads/')[1];out={ref:'refs/heads/'+ref,object:{type:'commit',sha:ref===p.branch?p.head:p.baseHead}}}process.stdout.write(JSON.stringify(out));`;
    writeFileSync(join(bin, 'gh'), gh, { mode: 0o755 });
    const run = () =>
        spawnSync(
            process.execPath,
            ['scripts/openLane.ts', '--adopt-pr', '12', '--expected-head', head, '--model', MODEL],
            { cwd: primary, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }, encoding: 'utf8' }
        );
    return {
        root,
        primary,
        git,
        head,
        base,
        run,
        data,
        lane: join(primary, '.agents', 'worktrees', `adopt-12-${head.slice(0, 12)}`),
    };
}

describe('real native custody with fake public reads and a disposable remote', () => {
    it('creates the exact locked checkout, truthfully logs present birth and replays without touching records', () => {
        const f = nativeFixture();
        const first = f.run();
        expect(first.status, first.stderr).toBe(0);
        expect(f.git('rev-parse', `refs/heads/${PR.branch}`)).toBe(f.head);
        expect(f.git('worktree', 'list', '--porcelain')).toContain(`locked ${AUTHOR_LOCK_REASON}`);
        const log = readFileSync(join(f.primary, '.git', 'logs', 'refs', 'heads', PR.branch), 'utf8');
        expect(log).toContain('sourdaw: present PR adoption PR_example');
        expect(log).not.toContain('branch: Created from');
        expect(
            execFileSync('git', ['config', '--worktree', '--get', 'user.email'], {
                cwd: f.lane,
                encoding: 'utf8',
            }).trim()
        ).toBe(AUTHOR_BOT_COMMIT_EMAIL);
        expect(existsSync(join(f.primary, '.agents', 'lane-stacks'))).toBe(false);
        const receipt = readFileSync(laneAdoptionPath(f.primary, PR.branch), 'utf8');
        const second = f.run();
        expect(second.status, second.stderr).toBe(0);
        expect(readFileSync(laneAdoptionPath(f.primary, PR.branch), 'utf8')).toBe(receipt);
        expect(
            readFileSync(join(f.root, 'gh-calls'), 'utf8')
                .trim()
                .split('\n')
                .every((line) => JSON.parse(line)[0] === 'api')
        ).toBe(true);
    });
    it('fails before fake GitHub when a required pinned source is missing or changed', () => {
        const f = nativeFixture();
        writeFileSync(
            join(f.primary, 'scripts', 'prContract.ts'),
            `${readFileSync(join(f.primary, 'scripts', 'prContract.ts'), 'utf8')}\n// changed\n`
        );
        const result = f.run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('source unavailable or changed');
        expect(existsSync(join(f.root, 'gh-calls'))).toBe(false);
        expect(f.git('for-each-ref', '--format=%(objectname)', `refs/heads/${PR.branch}`)).toBe('');
    });
    it('refuses an existing empty destination instead of letting Git adopt it', () => {
        const f = nativeFixture();
        mkdirSync(f.lane, { recursive: true });
        const result = f.run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('absent local branch, path and worktree');
        expect(readdirSync(f.lane)).toEqual([]);
        expect(f.git('for-each-ref', '--format=%(objectname)', `refs/heads/${PR.branch}`)).toBe('');
    });
    it('refuses a pre-existing branch and preserves the exact foreign tip', () => {
        const f = nativeFixture();
        f.git('branch', PR.branch, f.base);
        const result = f.run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('absent local branch');
        expect(f.git('rev-parse', `refs/heads/${PR.branch}`)).toBe(f.base);
        expect(existsSync(laneAdoptionPath(f.primary, PR.branch))).toBe(false);
    });
});
