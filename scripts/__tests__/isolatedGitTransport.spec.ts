import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { gitAuthenticatedArgs, githubChildEnv, spawnCapture, spawnRun } from '../githubAppIdentity.ts';
import { type GitRunner, withIsolatedGitTransport } from '../isolatedGitTransport.ts';

// Composed at runtime: the pull-request secret scan matches token-shaped literals in source.
const SENTINEL = ['ghs', 'sentinel', 'token'].join('_');

type Fixture = {
    root: string;
    primary: string;
    lane: string;
    remote: string;
    remoteUrl: string;
    helperDir: string;
    env: NodeJS.ProcessEnv;
    main: string;
};

function fixtureGit(cwd: string, args: string[]): string {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: {
            PATH: process.env.PATH,
            HOME: cwd,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
        },
    });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
}

function writeExecutable(path: string, source: string): void {
    writeFileSync(path, source);
    chmodSync(path, 0o700);
}

/** A program that records the token it was started with, then behaves as `cat`. */
function recorder(root: string, name: string): { program: string; record: string } {
    const program = join(root, name);
    const record = join(root, `${name}.record`);
    writeExecutable(program, `#!/bin/sh\nprintf '[%s]' "$GH_TOKEN" >> ${JSON.stringify(record)}\ncat "$@"\n`);
    return { program, record };
}

/**
 * The primary checkout and a lane worktree share one repository config, as Sourdaw's do; every
 * program and network setting below is planted there, where any lane can write it.
 */
function withFixture(body: (fixture: Fixture) => void): void {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-isolated-transport-')));
    try {
        const primary = join(root, 'primary');
        const lane = join(root, 'lane');
        const remote = join(root, 'remote.git');
        const helperDir = join(root, 'helper');
        mkdirSync(primary);
        mkdirSync(helperDir);
        fixtureGit(root, ['init', '-q', '--bare', '-b', 'main', remote]);
        fixtureGit(primary, ['init', '-q', '-b', 'main']);
        fixtureGit(primary, ['config', 'user.name', 'Fixture']);
        fixtureGit(primary, ['config', 'user.email', 'fixture@example.test']);
        writeFileSync(join(primary, 'f.txt'), 'base\n');
        fixtureGit(primary, ['add', 'f.txt']);
        fixtureGit(primary, ['commit', '-q', '-m', 'chore: base']);
        fixtureGit(primary, ['push', '-q', remote, 'main']);
        fixtureGit(primary, ['worktree', 'add', '-q', '-b', 'agent/lane', lane]);
        body({
            root,
            primary,
            lane,
            remote,
            remoteUrl: `file://${remote}`,
            helperDir,
            env: githubChildEnv(SENTINEL, join(root, 'gh-config')),
            main: fixtureGit(primary, ['rev-parse', 'HEAD']),
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function runner(cwd: string, env: NodeJS.ProcessEnv): GitRunner {
    return {
        capture: (args) => spawnCapture('git', args, { cwd, env }),
        run: (args) => spawnRun('git', args, { cwd, env }),
    };
}

describe('local git children keep the token from lane-named programs', () => {
    it('runs a lane-set clean filter without the token', () => {
        withFixture((f) => {
            const filter = recorder(f.root, 'filter');
            fixtureGit(f.primary, ['config', 'filter.lane.clean', filter.program]);
            writeFileSync(join(f.lane, '.gitattributes'), 'f.txt filter=lane\n');
            writeFileSync(join(f.lane, 'f.txt'), 'touched\n');

            spawnCapture('git', ['diff', '--', 'f.txt'], { cwd: f.lane, env: f.env });

            expect(readFileSync(filter.record, 'utf8')).toMatch(/^(\[\])+$/);
        });
    });

    it('runs a lane-set textconv without the token', () => {
        withFixture((f) => {
            const textconv = recorder(f.root, 'textconv');
            fixtureGit(f.primary, ['config', 'diff.lane.textconv', textconv.program]);
            writeFileSync(join(f.lane, '.gitattributes'), 'f.txt diff=lane\n');
            writeFileSync(join(f.lane, 'f.txt'), 'changed\n');
            fixtureGit(f.lane, ['commit', '-q', '-am', 'chore: change']);

            spawnCapture('git', ['diff', f.main, 'HEAD', '--', 'f.txt'], { cwd: f.lane, env: f.env });

            expect(readFileSync(textconv.record, 'utf8')).toMatch(/^(\[\])+$/);
        });
    });

    it('runs a lane-set merge driver without the token', () => {
        withFixture((f) => {
            const driver = recorder(f.root, 'driver');
            fixtureGit(f.primary, ['config', 'merge.lane.driver', `${driver.program} %O %A %B > /dev/null`]);
            writeFileSync(join(f.primary, '.gitattributes'), 'f.txt merge=lane\n');
            writeFileSync(join(f.primary, 'f.txt'), 'main\n');
            fixtureGit(f.primary, ['add', '.']);
            fixtureGit(f.primary, ['commit', '-q', '-m', 'chore: main side']);
            writeFileSync(join(f.lane, '.gitattributes'), 'f.txt merge=lane\n');
            writeFileSync(join(f.lane, 'f.txt'), 'lane\n');
            fixtureGit(f.lane, ['add', '.']);
            fixtureGit(f.lane, ['commit', '-q', '-m', 'chore: lane side']);

            spawnRun('git', ['merge', '--no-edit', 'main'], { cwd: f.lane, env: f.env });

            expect(readFileSync(driver.record, 'utf8')).toBe('[]');
        });
    });
});

describe('isolated git transport', () => {
    it('never starts a lane-set remote helper that a URL rewrite selects', () => {
        withFixture((f) => {
            const bin = join(f.root, 'bin');
            const record = join(f.root, 'helper.record');
            mkdirSync(bin);
            writeExecutable(
                join(bin, 'git-remote-lane'),
                `#!/bin/sh\nprintf 'ran' > ${JSON.stringify(record)}\nexit 1\n`
            );
            fixtureGit(f.primary, ['config', 'protocol.lane.allow', 'always']);
            fixtureGit(f.primary, ['config', 'url.lane::elsewhere.insteadOf', f.remoteUrl]);
            const env = { ...f.env, PATH: `${bin}:${process.env.PATH ?? ''}` };
            const fetch = ['fetch', f.remoteUrl, '+refs/heads/main:refs/remotes/origin/main'];

            withIsolatedGitTransport(runner(f.lane, env), { token: SENTINEL, helperDir: f.helperDir }, (transport) => {
                transport.run(fetch);
            });

            expect(existsSync(record)).toBe(false);
            expect(fixtureGit(f.primary, ['rev-parse', 'refs/remotes/origin/main'])).toBe(f.main);
            // The same fetch run in the lane itself starts the helper beside the credential.
            spawnSync('git', gitAuthenticatedArgs(SENTINEL, f.helperDir, fetch), { cwd: f.lane, env });
            expect(readFileSync(record, 'utf8')).toBe('ran');
        });
    });

    it('applies no lane-set URL-scoped or plain http settings', () => {
        withFixture((f) => {
            const planted = [
                ['http.https://github.com/.proxy', 'http://127.0.0.1:9'],
                ['http.https://github.com/.curloptResolve', 'github.com:443:127.0.0.1'],
                ['http.sslCAInfo', join(f.root, 'lane-ca.pem')],
            ];
            for (const [key, value] of planted) {
                fixtureGit(f.primary, ['config', key ?? '', value ?? '']);
            }
            const effective = (git: GitRunner) => git.capture(['config', '--list']).toLowerCase();

            const isolated = withIsolatedGitTransport(
                runner(f.lane, f.env),
                { token: SENTINEL, helperDir: f.helperDir },
                effective
            );

            expect(isolated).not.toContain('http.');
            expect(isolated).toContain('gc.auto=0');
            expect(isolated).toContain('maintenance.auto=false');
            // The lane's own config carries every planted key.
            const lane = effective(runner(f.lane, f.env));
            for (const [key] of planted) {
                expect(lane).toContain(`${(key ?? '').toLowerCase()}=`);
            }
        });
    });

    it('pushes the lane commit to the named remote, not to a lane-set push rewrite', () => {
        withFixture((f) => {
            const decoy = join(f.root, 'decoy.git');
            fixtureGit(f.root, ['init', '-q', '--bare', '-b', 'main', decoy]);
            fixtureGit(f.primary, ['config', `url.file://${decoy}.pushInsteadOf`, f.remoteUrl]);
            writeFileSync(join(f.lane, 'g.txt'), 'lane\n');
            fixtureGit(f.lane, ['add', 'g.txt']);
            fixtureGit(f.lane, ['commit', '-q', '-m', 'feat: lane']);
            const head = fixtureGit(f.lane, ['rev-parse', 'HEAD']);

            withIsolatedGitTransport(
                runner(f.lane, f.env),
                { token: SENTINEL, helperDir: f.helperDir },
                (transport) => {
                    transport.run(['push', '--no-verify', f.remoteUrl, `${head}:refs/heads/agent/lane`]);
                }
            );

            expect(fixtureGit(f.remote, ['rev-parse', 'refs/heads/agent/lane'])).toBe(head);
            expect(fixtureGit(decoy, ['for-each-ref'])).toBe('');
        });
    });

    it('carries fetched and pruned tracking refs back, leaving symbolic refs alone', () => {
        withFixture((f) => {
            fixtureGit(f.primary, ['update-ref', 'refs/remotes/origin/stale', f.main]);
            fixtureGit(f.primary, ['update-ref', 'refs/remotes/origin/main', f.main]);
            fixtureGit(f.primary, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
            const work = join(f.root, 'work');
            fixtureGit(f.root, ['clone', '-q', f.remote, work]);
            fixtureGit(work, [
                '-c',
                'user.name=F',
                '-c',
                'user.email=f@example.test',
                'commit',
                '-q',
                '--allow-empty',
                '-m',
                'chore: next',
            ]);
            fixtureGit(work, ['push', '-q', 'origin', 'HEAD:main', 'HEAD:feature']);
            const next = fixtureGit(work, ['rev-parse', 'HEAD']);

            withIsolatedGitTransport(
                runner(f.primary, f.env),
                { token: SENTINEL, helperDir: f.helperDir },
                (transport) => {
                    transport.run(['fetch', '--prune', f.remoteUrl, '+refs/heads/*:refs/remotes/origin/*']);
                }
            );

            expect(fixtureGit(f.primary, ['rev-parse', 'refs/remotes/origin/main'])).toBe(next);
            expect(fixtureGit(f.primary, ['rev-parse', 'refs/remotes/origin/feature'])).toBe(next);
            expect(fixtureGit(f.primary, ['for-each-ref', 'refs/remotes/origin/stale'])).toBe('');
            expect(fixtureGit(f.primary, ['symbolic-ref', 'refs/remotes/origin/HEAD'])).toBe(
                'refs/remotes/origin/main'
            );
            expect(fixtureGit(f.primary, ['cat-file', '-t', next])).toBe('commit');
        });
    });

    it('carries back a remote branch replaced by one nested under its name', () => {
        withFixture((f) => {
            fixtureGit(f.primary, ['update-ref', 'refs/remotes/origin/feature', f.main]);
            const work = join(f.root, 'work');
            fixtureGit(f.root, ['clone', '-q', f.remote, work]);
            fixtureGit(work, ['push', '-q', 'origin', 'HEAD:feature/x']);
            const run = () =>
                withIsolatedGitTransport(
                    runner(f.primary, f.env),
                    { token: SENTINEL, helperDir: f.helperDir },
                    (transport) => {
                        transport.run(['fetch', '--prune', f.remoteUrl, '+refs/heads/*:refs/remotes/origin/*']);
                    }
                );

            run();
            run();

            expect(fixtureGit(f.primary, ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/feature'])).toBe(
                'refs/remotes/origin/feature/x'
            );
            expect(fixtureGit(f.primary, ['rev-parse', 'refs/remotes/origin/feature/x'])).toBe(
                fixtureGit(work, ['rev-parse', 'HEAD'])
            );
        });
    });

    it('refuses to overwrite a tracking ref that moved while it fetched', () => {
        withFixture((f) => {
            fixtureGit(f.primary, ['update-ref', 'refs/remotes/origin/main', f.main]);
            const work = join(f.root, 'work');
            fixtureGit(f.root, ['clone', '-q', f.remote, work]);
            fixtureGit(work, [
                '-c',
                'user.name=F',
                '-c',
                'user.email=f@example.test',
                'commit',
                '-q',
                '--allow-empty',
                '-m',
                'chore: next',
            ]);
            fixtureGit(work, ['push', '-q', 'origin', 'HEAD:main']);
            fixtureGit(f.primary, ['commit', '-q', '--allow-empty', '-m', 'chore: concurrent']);
            const concurrent = fixtureGit(f.primary, ['rev-parse', 'HEAD']);

            expect(() =>
                withIsolatedGitTransport(
                    runner(f.primary, f.env),
                    { token: SENTINEL, helperDir: f.helperDir },
                    (transport) => {
                        transport.run(['fetch', f.remoteUrl, '+refs/heads/main:refs/remotes/origin/main']);
                        fixtureGit(f.primary, ['update-ref', 'refs/remotes/origin/main', concurrent]);
                    }
                )
            ).toThrow();
            expect(fixtureGit(f.primary, ['rev-parse', 'refs/remotes/origin/main'])).toBe(concurrent);
        });
    });

    it('removes its git directory and keeps the shared object store', () => {
        withFixture((f) => {
            let gitDir = '';
            withIsolatedGitTransport(
                runner(f.lane, f.env),
                { token: SENTINEL, helperDir: f.helperDir },
                (transport) => {
                    gitDir = transport.capture(['rev-parse', '--absolute-git-dir']);
                }
            );

            expect(gitDir).not.toBe('');
            expect(existsSync(gitDir)).toBe(false);
            expect(readdirSync(join(f.primary, '.git', 'objects')).length).toBeGreaterThan(2);
            expect(fixtureGit(f.lane, ['cat-file', '-t', f.main])).toBe('commit');
        });
    });

    it('refuses a credential-holding git child that names no isolated git directory', () => {
        withFixture((f) => {
            expect(() =>
                spawnCapture('git', gitAuthenticatedArgs(SENTINEL, f.helperDir, ['ls-remote', f.remoteUrl]), {
                    cwd: f.lane,
                    env: f.env,
                })
            ).toThrow('refusing a token-bearing git child outside an isolated git directory');
        });
    });

    it('refuses a credential-holding git child that names the shared repository as its git directory', () => {
        withFixture((f) => {
            const credentialArgs = (gitDir: string) => [
                `--git-dir=${gitDir}`,
                ...gitAuthenticatedArgs(SENTINEL, f.helperDir, ['ls-remote', f.remoteUrl]),
            ];

            expect(() =>
                spawnCapture('git', credentialArgs(join(f.primary, '.git')), { cwd: f.lane, env: f.env })
            ).toThrow('refusing a token-bearing git child outside an isolated git directory');
            expect(() => spawnRun('git', credentialArgs(join(f.primary, '.git')), { cwd: f.lane, env: f.env })).toThrow(
                'refusing a token-bearing git child outside an isolated git directory'
            );
        });
    });

    it('refuses a git directory laid out like a transport directory that the transport did not create', () => {
        withFixture((f) => {
            const lookalike = mkdtempSync(join(tmpdir(), 'sourdaw-git-transport-'));
            try {
                fixtureGit(f.root, ['init', '-q', '--bare', lookalike]);

                expect(() =>
                    spawnCapture(
                        'git',
                        [
                            `--git-dir=${lookalike}`,
                            ...gitAuthenticatedArgs(SENTINEL, f.helperDir, ['ls-remote', f.remoteUrl]),
                        ],
                        { cwd: f.lane, env: f.env }
                    )
                ).toThrow('refusing a token-bearing git child outside an isolated git directory');
            } finally {
                rmSync(lookalike, { recursive: true, force: true });
            }
        });
    });

    it('refuses a -C value spelled as a live git-dir option, which leaves git in the directory it names', () => {
        withFixture((f) => {
            withIsolatedGitTransport(
                runner(f.lane, f.env),
                { token: SENTINEL, helperDir: f.helperDir },
                (transport) => {
                    const gitDir = transport.capture(['rev-parse', '--git-dir']);
                    // A repository planted at the relative path `--git-dir=<live directory>` under the lane.
                    const planted = join(f.lane, `--git-dir=${gitDir}`);
                    mkdirSync(planted, { recursive: true });
                    fixtureGit(planted, ['init', '-q']);

                    expect(() =>
                        spawnCapture(
                            'git',
                            [
                                '-C',
                                `--git-dir=${gitDir}`,
                                ...gitAuthenticatedArgs(SENTINEL, f.helperDir, ['ls-remote', f.remoteUrl]),
                            ],
                            { cwd: f.lane, env: f.env }
                        )
                    ).toThrow('refusing a token-bearing git child outside an isolated git directory');
                }
            );
        });
    });

    it('refuses a transport git directory whose environment moves its common directory to the shared repository', () => {
        withFixture((f) => {
            withIsolatedGitTransport(
                runner(f.lane, f.env),
                { token: SENTINEL, helperDir: f.helperDir },
                (transport) => {
                    const gitDir = transport.capture(['rev-parse', '--git-dir']);
                    const listRemote = [
                        `--git-dir=${gitDir}`,
                        ...gitAuthenticatedArgs(SENTINEL, f.helperDir, ['ls-remote', f.remoteUrl]),
                    ];

                    // GIT_COMMON_DIR makes git read the shared repository's config beside the live directory.
                    for (const key of ['GIT_COMMON_DIR', 'git_common_dir']) {
                        expect(() =>
                            spawnCapture('git', listRemote, {
                                cwd: f.lane,
                                env: { ...f.env, [key]: join(f.primary, '.git') },
                            })
                        ).toThrow('refusing a token-bearing git child outside an isolated git directory');
                    }
                    expect(spawnCapture('git', listRemote, { cwd: f.lane, env: f.env })).toContain(f.main);
                }
            );
        });
    });

    it('refuses a transport git directory that a later git-dir overrides or a path that only resolves to it', () => {
        withFixture((f) => {
            withIsolatedGitTransport(
                runner(f.lane, f.env),
                { token: SENTINEL, helperDir: f.helperDir },
                (transport) => {
                    const gitDir = transport.capture(['rev-parse', '--absolute-git-dir']);
                    const listRemote = gitAuthenticatedArgs(SENTINEL, f.helperDir, ['ls-remote', f.remoteUrl]);

                    // Git honours the last --git-dir, so a trailing one would run against the shared repository.
                    expect(() =>
                        spawnCapture(
                            'git',
                            [`--git-dir=${gitDir}`, `--git-dir=${join(f.primary, '.git')}`, ...listRemote],
                            {
                                cwd: f.lane,
                                env: f.env,
                            }
                        )
                    ).toThrow('refusing a token-bearing git child outside an isolated git directory');
                    expect(() =>
                        spawnCapture('git', [`--git-dir=${gitDir}/../${basename(gitDir)}`, ...listRemote], {
                            cwd: f.lane,
                            env: f.env,
                        })
                    ).toThrow('refusing a token-bearing git child outside an isolated git directory');
                }
            );
        });
    });

    it.each([
        ['returned', false],
        ['thrown', true],
    ])('refuses a transport git directory once its transport body has %s', (_exit, throws) => {
        withFixture((f) => {
            let gitDir = '';
            const transportRun = () =>
                withIsolatedGitTransport(
                    runner(f.lane, f.env),
                    { token: SENTINEL, helperDir: f.helperDir },
                    (transport) => {
                        gitDir = transport.capture(['rev-parse', '--git-dir']);
                        expect(transport.capture(['ls-remote', f.remoteUrl, 'refs/heads/main'])).toContain(f.main);
                        if (throws) {
                            throw new Error('body failed');
                        }
                    }
                );
            if (throws) {
                expect(transportRun).toThrow('body failed');
            } else {
                transportRun();
            }
            mkdirSync(gitDir);
            fixtureGit(f.root, ['init', '-q', '--bare', gitDir]);

            expect(() =>
                spawnCapture(
                    'git',
                    [`--git-dir=${gitDir}`, ...gitAuthenticatedArgs(SENTINEL, f.helperDir, ['ls-remote', f.remoteUrl])],
                    { cwd: f.lane, env: f.env }
                )
            ).toThrow('refusing a token-bearing git child outside an isolated git directory');
            rmSync(gitDir, { recursive: true, force: true });
        });
    });
});
