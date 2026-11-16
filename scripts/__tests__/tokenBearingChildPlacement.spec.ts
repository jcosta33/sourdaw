import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertTokenBearingGitChildIsHookFree, tokenFreeGitEnv } from '../tokenBearingChildPlacement.ts';

const sentinel = `sentinel-${process.pid}-${Date.now()}`;

describe('tokenFreeGitEnv', () => {
    it.each(['GH_CONFIG_DIR', 'gh_config_dir', 'Gh_Config_Dir', 'GH_HOST', 'GH_REPO'])(
        'drops the GitHub CLI variable %s from a git environment',
        (key) => {
            expect(tokenFreeGitEnv({ [key]: sentinel, PATH: '/usr/bin' })).toEqual({ PATH: '/usr/bin' });
        }
    );

    it('keeps the variables a git child needs', () => {
        const env = { PATH: '/usr/bin', HOME: '/home/fixture', GIT_DIR: '/repo/.git', GITHUB_WORKSPACE: '/w' };

        expect(tokenFreeGitEnv(env)).toEqual(env);
    });
});

/**
 * A stand-in git that records the environment and arguments of the hook listing it serves, then
 * answers as `git config --get-regexp` does when nothing matches.
 */
function withRecordingGit(
    body: (fixture: { git: string; cwd: string; env: () => string; argv: () => string }) => void
) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sourdaw-hook-listing-')));
    try {
        const git = join(root, 'recording-git');
        const envRecord = join(root, 'env');
        const argvRecord = join(root, 'argv');
        writeFileSync(
            git,
            [
                '#!/bin/sh',
                `env > ${JSON.stringify(envRecord)}`,
                `printf '%s\\n' "$@" > ${JSON.stringify(argvRecord)}`,
                'exit 1',
                '',
            ].join('\n')
        );
        chmodSync(git, 0o755);
        body({
            git,
            cwd: root,
            env: () => readFileSync(envRecord, 'utf8'),
            argv: () => readFileSync(argvRecord, 'utf8'),
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

describe('the hook listing of a token-bearing git child', () => {
    it.each(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR'])('runs without the %s its caller handed over', (key) => {
        withRecordingGit((f) => {
            assertTokenBearingGitChildIsHookFree(
                'git',
                f.git,
                ['status'],
                f.cwd,
                { PATH: process.env.PATH, GH_TOKEN: sentinel, [key]: sentinel },
                {}
            );

            expect(f.argv()).toContain('--get-regexp');
            expect(f.env()).not.toContain(sentinel);
        });
    });
});

describe('the leading options a token-bearing git child may carry', () => {
    it.each(['--no-replace-objects', '--no-pager', '--no-optional-locks', '--literal-pathspecs', '--bare'])(
        'accepts %s and lists hooks with it',
        (flag) => {
            withRecordingGit((f) => {
                assertTokenBearingGitChildIsHookFree(
                    'git',
                    f.git,
                    [flag, 'status'],
                    f.cwd,
                    { PATH: process.env.PATH, GH_TOKEN: sentinel },
                    {}
                );

                expect(f.argv().split('\n')).toContain(flag);
            });
        }
    );

    it.each(['--exec-path', '--exec-path=/tmp/planted', '--config-env=core.pager=PAGER'])('refuses %s', (flag) => {
        withRecordingGit((f) => {
            expect(() =>
                assertTokenBearingGitChildIsHookFree(
                    'git',
                    f.git,
                    [flag, 'status'],
                    f.cwd,
                    { PATH: process.env.PATH, GH_TOKEN: sentinel },
                    {}
                )
            ).toThrow(`refusing a token-bearing git child: unrecognised leading option ${flag}`);
        });
    });
});
