import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    AUTHOR_BOT_COMMIT_EMAIL,
    AUTHOR_BOT_COMMIT_NAME,
    AUTHOR_BOT_NODE_ID,
    AUTHOR_LOCK_REASON,
    REQUIRED_REPOSITORY,
    githubAuthorizationGitEnv,
} from '../githubAppIdentity.ts';
import { parseOpenLaneArgs } from '../openLane.ts';
import {
    adoptPresentPullRequest,
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
import { parsePublishLaneArgs } from '../publishLane.ts';
import { resolveTrustedExecutable, trustedDependencyGraphs } from '../trustedGithubWriteBootstrap.ts';

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
        observe: () => PR,
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
        expect(parsePublishLaneArgs(['--adopt-pr', '12', '--expected-head', HEAD, '--model', MODEL])).toMatchObject({
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
            expect(() => parsePublishLaneArgs(args)).toThrow();
        }
        expect(parseOpenLaneArgs(['example', '--type', 'feat', '--model', MODEL])).toMatchObject({
            slug: 'example',
            type: 'feat',
            model: MODEL,
        });
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
                    if (mode === 'duplicate') {
                        return JSON.stringify([...JSON.parse(raw), ...JSON.parse(raw)]);
                    }
                    if (mode === 'truncated') {
                        return '{}';
                    }
                    return raw;
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
    it('refuses guard failure evidence redirected through a symlink or a non-file entry', () => {
        const root = temporary();
        const directory = join(root, '.agents', 'guard-failures');
        mkdirSync(directory, { recursive: true });
        const elsewhere = join(root, 'elsewhere.json');
        writeFileSync(elsewhere, '{}');
        symlinkSync(elsewhere, join(directory, 'linked.json'));
        expect(() => assertNoAdoptionGuardFailure(root, PR.branch)).toThrow('guard failure evidence is redirected');
        unlinkSync(join(directory, 'linked.json'));
        mkdirSync(join(directory, 'nested.json'));
        expect(() => assertNoAdoptionGuardFailure(root, PR.branch)).toThrow('guard failure evidence is redirected');
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
    const gitPath = resolveTrustedExecutable('git');
    const env: NodeJS.ProcessEnv = {
        ...githubAuthorizationGitEnv(),
        PATH: [bin, dirname(gitPath), dirname(process.execPath)].join(delimiter),
    };
    for (const key of Object.keys(env)) {
        if (key.startsWith('SOURDAW_TRUSTED_')) {
            delete env[key];
        }
    }
    mkdirSync(primary);
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, 'node'));
    mkdirSync(join(primary, 'scripts'));
    const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
    for (const path of trustedDependencyGraphs['lane:publish']) {
        mkdirSync(dirname(join(primary, path)), { recursive: true });
        writeFileSync(join(primary, path), source(path));
    }
    const publisher = source('scripts/publishLane.ts');
    const contract = source('scripts/prContract.ts');
    const identity = source('scripts/githubAppIdentity.ts');
    const manifest: { scripts: Record<string, string> } = JSON.parse(source('package.json'));
    writeFileSync(
        join(primary, 'package.json'),
        JSON.stringify({ type: 'module', scripts: { 'lane:publish': manifest.scripts['lane:publish'] } })
    );
    writeFileSync(join(primary, '.gitignore'), '.agents/\n');
    writeFileSync(join(primary, 'foreign.txt'), 'original');
    writeFileSync(join(primary, 'scripts', 'publishLane.ts'), "throw new Error('stale-primary-publisher-executed');\n");
    const git = (...args: string[]) =>
        execFileSync(gitPath, ['-c', 'core.hooksPath=/dev/null', ...args], {
            cwd: primary,
            env,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
    git('init', '-b', 'main');
    git('config', 'user.name', AUTHOR_BOT_COMMIT_NAME);
    git('config', 'user.email', AUTHOR_BOT_COMMIT_EMAIL);
    git('add', '.');
    git('commit', '-m', 'feat: old physical primary');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'tooling-main');
    writeFileSync(join(primary, 'scripts', 'publishLane.ts'), publisher);
    writeFileSync(join(primary, 'scripts', 'prContract.ts'), contract);
    const declaration = 'export async function authenticatePublishingAuthor(';
    expect(identity).toContain(declaration);
    writeFileSync(
        join(primary, 'scripts', 'githubAppIdentity.ts'),
        `${identity.replace(declaration, 'export async function unusedFixtureAuthenticatePublishingAuthor(')}
export async function authenticatePublishingAuthor(input) {
    writeFileSync(join(input.primaryRoot, 'auth-attempted'), 'ordinary author gate');
    throw new Error('controlled ordinary author authentication');
}
`
    );
    git('add', 'scripts');
    git('commit', '-m', 'feat: pinned native adoption');
    const pin = git('rev-parse', 'HEAD');
    const nextPin = git(
        'commit-tree',
        git('rev-parse', `${pin}^{tree}`),
        '-p',
        pin,
        '-m',
        'feat: concurrent same-tree main'
    );
    git('checkout', '-b', PR.branch, base);
    const hookMarker = join(root, 'hook-executed');
    const filterMarker = join(root, 'filter-executed');
    mkdirSync(join(primary, '.githooks'));
    writeFileSync(
        join(primary, '.githooks', 'post-checkout'),
        `#!${process.execPath}\nimport('node:fs').then(fs=>fs.writeFileSync(${JSON.stringify(hookMarker)},'hook ran'));\n`,
        { mode: 0o755 }
    );
    writeFileSync(
        join(primary, '.githooks', 'filter.cjs'),
        `require('node:fs').writeFileSync(${JSON.stringify(filterMarker)},'filter ran');process.stdin.pipe(process.stdout);\n`
    );
    writeFileSync(join(primary, '.gitattributes'), 'child.txt filter=adopted\n');
    writeFileSync(join(primary, 'child.txt'), 'unexecuted child data');
    git('add', '.');
    git('update-index', '--chmod=+x', '.githooks/post-checkout');
    git('commit', '-m', 'feat: existing child');
    const head = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/heads/main', pin, base);
    execFileSync(gitPath, ['clone', '--bare', primary, remote], { env, stdio: 'pipe' });
    git('update-ref', 'refs/heads/main', base, pin);
    git('checkout', 'main');
    git('update-ref', '-d', `refs/heads/${PR.branch}`, head);
    git('remote', 'add', 'origin', remote);
    git('fetch', 'origin', 'main');
    git('config', `url.${remote}.insteadOf`, 'https://github.com/jcosta33/sourdaw.git');
    git('config', 'core.hooksPath', '.githooks');
    git('config', 'filter.adopted.smudge', `"${process.execPath}" .githooks/filter.cjs`);
    git('config', 'filter.adopted.clean', `"${process.execPath}" .githooks/filter.cjs`);
    writeFileSync(join(primary, 'foreign.txt'), 'foreign work stays untouched');
    const data = join(root, 'public.json');
    const control = join(root, 'control.json');
    const calls = join(root, 'gh-calls');
    writeFileSync(data, JSON.stringify({ ...PR, head, baseHead: pin }));
    writeFileSync(control, '{}');
    writeFileSync(
        join(bin, 'git'),
        `#!${process.execPath}
const fs=require('node:fs');const cp=require('node:child_process');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(join(root, 'git-calls'))},JSON.stringify(args)+'\\n');const control=JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8'));
if(control.failFetch&&args[0]==='fetch'&&args[1]==='origin'&&args[2]==='main'){process.stderr.write('controlled origin fetch failure');process.exit(86)}
const result=cp.spawnSync(${JSON.stringify(gitPath)},args,{env:process.env,encoding:'utf8'});process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');process.exitCode=result.status??87;
`,
        { mode: 0o755 }
    );
    writeFileSync(
        join(bin, 'gh'),
        `#!${process.execPath}
const fs=require('node:fs');const cp=require('node:child_process');const p=JSON.parse(fs.readFileSync(${JSON.stringify(data)},'utf8'));const control=JSON.parse(fs.readFileSync(${JSON.stringify(control)},'utf8'));const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(a)+'\\n');if(a[0]!=='api'||a.some(x=>['--method','-X','-f','-F'].includes(x))){process.exit(81)}
if(control.movePin&&!control.moved){cp.execFileSync(${JSON.stringify(gitPath)},['update-ref','refs/remotes/origin/main',control.movePin],{cwd:${JSON.stringify(primary)}});control.moved=true;fs.writeFileSync(${JSON.stringify(control)},JSON.stringify(control))}
const u=a.at(-1);const c={number:p.number,node_id:p.id,state:'open',merged_at:null,user:{node_id:p.authorId,type:'Bot'},head:{ref:p.branch,sha:p.head,repo:{full_name:p.repository}},base:{ref:p.base,repo:{full_name:p.repository}}};let out;
if(u.includes('?state=all')){out=[[c]]}else if(u.includes('/git/ref/heads/')){const ref=u.split('/git/ref/heads/')[1];out={ref:'refs/heads/'+ref,object:{type:'commit',sha:ref===p.branch?p.head:p.baseHead}}}else if(u.endsWith('/pulls/'+p.number)){out=c}else{process.exit(82)}process.stdout.write(JSON.stringify(out));
`,
        { mode: 0o755 }
    );
    const args = ['--run', 'lane:publish', '--', '--adopt-pr', '12', '--expected-head', head, '--model', MODEL];
    const run = (extraEnv: NodeJS.ProcessEnv = {}) => {
        const result = spawnSync(process.execPath, args, {
            cwd: primary,
            env: { ...env, ...extraEnv },
            encoding: 'utf8',
        });
        if (result.stderr.includes('launcher does not match')) {
            const physical = readFileSync(join(primary, 'scripts', 'trustedGithubWriteBootstrap.ts'), 'utf8');
            const pinned = execFileSync(gitPath, ['show', `${pin}:scripts/trustedGithubWriteBootstrap.ts`], {
                cwd: primary,
                env,
                encoding: 'utf8',
            });
            result.stderr += JSON.stringify({
                pin,
                actualPin: git('rev-parse', 'origin/main'),
                physicalLength: physical.length,
                pinnedLength: pinned.length,
                equal: physical === pinned,
                calls: readFileSync(join(root, 'git-calls'), 'utf8').split('\n').slice(-10),
            });
        }
        return result;
    };
    const concurrent = () =>
        new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
            const child = spawn(process.execPath, args, { cwd: primary, env, stdio: ['ignore', 'pipe', 'pipe'] });
            let stderr = '';
            child.stderr.on('data', (chunk: Buffer) => {
                stderr += chunk.toString();
            });
            child.on('error', reject);
            child.on('close', (code) => resolve({ code, stderr }));
        });
    return {
        root,
        primary,
        git,
        gitPath,
        env,
        head,
        base,
        pin,
        nextPin,
        run,
        concurrent,
        data,
        control,
        calls,
        hookMarker,
        filterMarker,
        lane: join(primary, '.agents', 'worktrees', `adopt-12-${head.slice(0, 12)}`),
        readonlyCalls: () => {
            if (!existsSync(calls)) {
                return [];
            }
            return readFileSync(calls, 'utf8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line));
        },
        remoteHead: () =>
            execFileSync(gitPath, ['--git-dir', remote, 'rev-parse', `refs/heads/${PR.branch}`], {
                env,
                encoding: 'utf8',
            }).trim(),
        calibrate: () => {
            const probe = join(root, 'callback-calibration');
            const filter = `"${process.execPath}" "${join(probe, '.githooks', 'filter.cjs')}"`;
            git('config', 'filter.adopted.smudge', filter);
            git('config', 'filter.adopted.clean', filter);
            const calibration = spawnSync(
                gitPath,
                ['-c', `core.hooksPath=${join(probe, '.githooks')}`, 'worktree', 'add', '--detach', probe, head],
                {
                    cwd: primary,
                    env,
                    encoding: 'utf8',
                }
            );
            expect(calibration.status, calibration.stderr).toBe(0);
            expect(existsSync(hookMarker), calibration.stderr).toBe(true);
            expect(existsSync(filterMarker), calibration.stderr).toBe(true);
            unlinkSync(hookMarker);
            unlinkSync(filterMarker);
            const adopted = join(primary, '.agents', 'worktrees', `adopt-12-${head.slice(0, 12)}`);
            git('config', 'core.hooksPath', join(adopted, '.githooks'));
            const adoptedFilter = `"${process.execPath}" "${join(adopted, '.githooks', 'filter.cjs')}"`;
            git('config', 'filter.adopted.smudge', adoptedFilter);
            git('config', 'filter.adopted.clean', adoptedFilter);
        },
    };
}

function expectNoRemoteOrAdoptedExecution(f: ReturnType<typeof nativeFixture>): void {
    expect(f.remoteHead()).toBe(f.head);
    expect(existsSync(join(f.primary, 'auth-attempted'))).toBe(false);
    expect(existsSync(f.hookMarker)).toBe(false);
    expect(existsSync(f.filterMarker)).toBe(false);
    expect(readFileSync(join(f.primary, 'foreign.txt'), 'utf8')).toBe('foreign work stays untouched');
    expect(
        f
            .readonlyCalls()
            .every(
                (args: string[]) =>
                    args[0] === 'api' && !args.some((arg) => ['--method', '-X', '-f', '-F'].includes(arg))
            )
    ).toBe(true);
}

describe('real pinned publisher package with a stale physical primary', () => {
    it('acquires and replays truthful custody without author auth, PR writes or adopted callbacks', () => {
        const f = nativeFixture();
        f.calibrate();
        const first = f.run({ SOURDAW_TRUSTED_PRIMARY_ROOT: '/forged/root', SOURDAW_TRUSTED_GIT_PATH: '/forged/git' });
        expect(first.status, first.stderr).toBe(0);
        expect(f.git('rev-parse', `refs/heads/${PR.branch}`)).toBe(f.head);
        expect(f.git('worktree', 'list', '--porcelain')).toContain(`locked ${AUTHOR_LOCK_REASON}`);
        expect(readFileSync(join(f.primary, 'scripts', 'publishLane.ts'), 'utf8')).toContain(
            'stale-primary-publisher-executed'
        );
        expect(readFileSync(join(f.lane, 'scripts', 'publishLane.ts'), 'utf8')).toContain(
            'stale-primary-publisher-executed'
        );
        expect(readFileSync(join(f.primary, '.git', 'logs', 'refs', 'heads', PR.branch), 'utf8')).toContain(
            'sourdaw: present PR adoption PR_example'
        );
        expect(f.git('-C', f.lane, 'config', '--worktree', '--get', 'user.email')).toBe(AUTHOR_BOT_COMMIT_EMAIL);
        expect(f.git('config', '--get', `branch.${PR.branch}.sourdaw-author-model`)).toBe(MODEL);
        expect(readLaneAdoptionRecord(f.primary, PR.branch)?.sourceCommit).toBe(f.pin);
        expect(existsSync(join(f.primary, '.agents', 'lane-stacks'))).toBe(false);
        expectNoRemoteOrAdoptedExecution(f);
        const receipt = readFileSync(laneAdoptionPath(f.primary, PR.branch), 'utf8');
        const second = f.run();
        expect(second.status, second.stderr).toBe(0);
        expect(readFileSync(laneAdoptionPath(f.primary, PR.branch), 'utf8')).toBe(receipt);
        expectNoRemoteOrAdoptedExecution(f);
    }, 30_000);
    it('binds the executed snapshot pin despite a later origin/main ref movement', () => {
        const f = nativeFixture();
        writeFileSync(f.control, JSON.stringify({ movePin: f.nextPin }));
        const result = f.run();
        expect(result.status, result.stderr).toBe(0);
        expect(f.git('rev-parse', 'origin/main')).toBe(f.nextPin);
        expect(readLaneAdoptionRecord(f.primary, PR.branch)?.sourceCommit).toBe(f.pin);
        expectNoRemoteOrAdoptedExecution(f);
    }, 30_000);
    it('retains the existing explicit cached-pin fallback and refuses an absent cached pin', () => {
        const cached = nativeFixture();
        writeFileSync(cached.control, JSON.stringify({ failFetch: true }));
        const pass = cached.run();
        expect(pass.status, pass.stderr).toBe(0);
        expect(pass.stderr).toContain('trusted snapshot may be stale');
        expect(readLaneAdoptionRecord(cached.primary, PR.branch)?.sourceCommit).toBe(cached.pin);
        const absent = nativeFixture();
        absent.git('update-ref', '-d', 'refs/remotes/origin/main', absent.pin);
        writeFileSync(absent.control, JSON.stringify({ failFetch: true }));
        const fail = absent.run();
        expect(fail.status).toBe(1);
        expect(absent.readonlyCalls()).toEqual([]);
        expect(absent.git('for-each-ref', '--format=%(objectname)', `refs/heads/${PR.branch}`)).toBe('');
    }, 30_000);
    it('refuses a mutated primary loader before any public or custody effect', () => {
        const f = nativeFixture();
        const path = join(f.primary, 'scripts', 'trustedGithubWriteBootstrap.ts');
        writeFileSync(path, `${readFileSync(path, 'utf8')}\n// different loader\n`);
        const result = f.run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('protected primary launcher does not match');
        expect(f.readonlyCalls()).toEqual([]);
        expect(existsSync(laneAdoptionPath(f.primary, PR.branch))).toBe(false);
    }, 30_000);
    it('refuses a missing required publisher blob before public or custody effects', () => {
        const f = nativeFixture();
        f.git('read-tree', f.pin);
        f.git('update-index', '--force-remove', 'scripts/publishLane.ts');
        const incomplete = f.git('commit-tree', f.git('write-tree'), '-p', f.pin, '-m', 'test: missing publisher');
        f.git('push', 'origin', `${incomplete}:refs/heads/main`);
        const result = f.run();
        expect(result.status).toBe(1);
        expect(f.readonlyCalls()).toEqual([]);
        expect(f.git('for-each-ref', '--format=%(objectname)', `refs/heads/${PR.branch}`)).toBe('');
        expect(existsSync(laneAdoptionPath(f.primary, PR.branch))).toBe(false);
        expectNoRemoteOrAdoptedExecution(f);
    }, 30_000);
    it('refuses foreign cwd through the real primary launcher before local custody', () => {
        const f = nativeFixture();
        const foreign = join(f.root, 'foreign-worktree');
        f.git('worktree', 'add', '--detach', foreign, f.base);
        const result = spawnSync(
            process.execPath,
            [
                join(f.primary, 'scripts', 'trustedGithubWriteBootstrap.ts'),
                'lane:publish',
                '--adopt-pr',
                '12',
                '--expected-head',
                f.head,
                '--model',
                MODEL,
            ],
            { cwd: foreign, env: f.env, encoding: 'utf8' }
        );
        expect(f.git('for-each-ref', '--format=%(objectname)', `refs/heads/${PR.branch}`)).toBe('');
        expect(f.readonlyCalls()).toEqual([]);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('protected primary checkout');
    }, 30_000);
    it('preserves the ordinary author gate on the same real pinned package route', () => {
        const f = nativeFixture();
        const adopted = f.run();
        expect(adopted.status, adopted.stderr).toBe(0);
        const result = spawnSync(process.execPath, ['--run', 'lane:publish', '--', '--lane', f.lane], {
            cwd: f.primary,
            env: f.env,
            encoding: 'utf8',
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('controlled ordinary author authentication');
        expect(readFileSync(join(f.primary, 'auth-attempted'), 'utf8')).toBe('ordinary author gate');
        expect(f.remoteHead()).toBe(f.head);
    }, 30_000);
    it('admits at most one custody record under concurrent matching calls', async () => {
        const f = nativeFixture();
        const results = await Promise.all([f.concurrent(), f.concurrent()]);
        expect(
            results.some((result) => result.code === 0),
            JSON.stringify(results)
        ).toBe(true);
        expect(results.every((result) => result.code === 0 || result.code === 1)).toBe(true);
        expect(f.git('rev-parse', `refs/heads/${PR.branch}`)).toBe(f.head);
        expect(f.git('worktree', 'list', '--porcelain').split(`branch refs/heads/${PR.branch}`).length - 1).toBe(1);
        expect(
            readdirSync(join(f.primary, '.agents', 'lane-adoptions')).filter((file) => file.endsWith('.json'))
        ).toHaveLength(1);
        expectNoRemoteOrAdoptedExecution(f);
    }, 30_000);
    it.each(['branch', 'empty destination'])(
        'preserves a foreign %s collision through the native route',
        (kind) => {
            const f = nativeFixture();
            if (kind === 'branch') {
                f.git('branch', PR.branch, f.base);
            } else {
                mkdirSync(f.lane, { recursive: true });
            }
            const result = f.run();
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('absent local branch, path and worktree');
            if (kind === 'branch') {
                expect(f.git('rev-parse', `refs/heads/${PR.branch}`)).toBe(f.base);
            } else {
                expect(readdirSync(f.lane)).toEqual([]);
            }
            expect(existsSync(laneAdoptionPath(f.primary, PR.branch))).toBe(false);
            expectNoRemoteOrAdoptedExecution(f);
        },
        30_000
    );
});
