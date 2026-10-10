import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function runSetup(cacheHit: 'true' | 'false', installed: boolean, incomplete = false, wrongPin = false) {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-pinned-rust-'));
    roots.push(root);
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const log = join(root, 'rustup.log');
    const githubEnv = join(root, 'github-env');
    const toolchain = join(root, 'rust-toolchain.toml');
    writeFileSync(
        toolchain,
        '[toolchain]\nchannel = "nightly-2026-04-14"\nprofile = "minimal"\ncomponents = ["rustfmt", "clippy"]\n'
    );
    writeFileSync(
        join(bin, 'rustup'),
        `#!/bin/sh
printf '%s\\n' "$*" >> "$RUSTUP_TEST_LOG"
case "$*" in
  'toolchain install nightly-2026-04-14 --profile minimal --component rustfmt --component clippy')
    [ "$RUSTUP_TEST_INSTALLED" = 1 ] || exit 73; exit 0 ;;
  *) [ "$RUSTUP_AUTO_INSTALL" = 0 ] || exit 76 ;;
esac
case "$*" in
  'show active-toolchain')
    [ "$RUSTUP_TEST_INSTALLED" = 1 ] || exit 74
    if [ "$RUSTUP_TEST_WRONG_PIN" = 1 ]; then
      printf '%s\\n' 'nightly-2026-04-15-x86_64-unknown-linux-gnu (overridden by file)'
    else
      printf '%s\\n' 'nightly-2026-04-14-x86_64-unknown-linux-gnu (overridden by file)'
    fi ;;
  'component list --installed --toolchain nightly-2026-04-14-x86_64-unknown-linux-gnu')
    printf '%s\\n' 'rustc-x86_64-unknown-linux-gnu' 'cargo-x86_64-unknown-linux-gnu'
    [ "$RUSTUP_TEST_INCOMPLETE" = 1 ] || printf '%s\\n' 'rustfmt-x86_64-unknown-linux-gnu' 'clippy-x86_64-unknown-linux-gnu' ;;
  'run nightly-2026-04-14-x86_64-unknown-linux-gnu rustc -vV') printf '%s\\n' 'rustc 1.89.0-nightly' 'host: x86_64-unknown-linux-gnu' ;;
  'run nightly-2026-04-14-x86_64-unknown-linux-gnu cargo --version') printf '%s\\n' 'cargo 1.89.0-nightly' ;;
  'run nightly-2026-04-14-x86_64-unknown-linux-gnu rustfmt --version') printf '%s\\n' 'rustfmt 1.8.0-nightly' ;;
  'run nightly-2026-04-14-x86_64-unknown-linux-gnu cargo-clippy --version') printf '%s\\n' 'clippy 0.1.89' ;;
  *) exit 75 ;;
esac
`,
        { mode: 0o755 }
    );
    const result = spawnSync('bash', ['scripts/ensurePinnedRustToolchain.sh', cacheHit, toolchain], {
        cwd: join(import.meta.dirname, '../..'),
        encoding: 'utf8',
        env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            GITHUB_ENV: githubEnv,
            RUSTUP_TEST_LOG: log,
            RUSTUP_TEST_INSTALLED: installed ? '1' : '0',
            RUSTUP_TEST_INCOMPLETE: incomplete ? '1' : '0',
            RUSTUP_TEST_WRONG_PIN: wrongPin ? '1' : '0',
            RUSTUP_DIST_SERVER: 'http://127.0.0.1:9',
        },
    });
    return { result, calls: existsSync(log) ? readFileSync(log, 'utf8') : '', githubEnv };
}

describe('pinned Rust setup', () => {
    it('accepts a complete exact hit without making an installation request', () => {
        const { result, calls, githubEnv } = runSetup('true', true);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('source=exact-cache');
        expect(calls).not.toMatch(/^show$/m);
        expect(calls).toContain('run nightly-2026-04-14-x86_64-unknown-linux-gnu rustc -vV');
        expect(readFileSync(githubEnv, 'utf8')).toContain('RUSTUP_AUTO_INSTALL=0');
    });

    it('fails a missing or incomplete exact hit without falling back to distribution', () => {
        for (const [installed, incomplete] of [
            [false, false],
            [true, true],
        ]) {
            const { result, calls } = runSetup('true', installed, incomplete);
            expect(result.status).not.toBe(0);
            expect(calls).not.toMatch(/^show$/m);
        }
        const mismatched = runSetup('true', true, false, true);
        expect(mismatched.result.status).not.toBe(0);
        expect(mismatched.calls).not.toMatch(/^show$/m);
    });

    it('propagates a cold installation failure before verification', () => {
        const { result, calls } = runSetup('false', false);
        expect(result.status).toBe(73);
        expect(calls).toBe(
            'toolchain install nightly-2026-04-14 --profile minimal --component rustfmt --component clippy\n'
        );
    });
});
