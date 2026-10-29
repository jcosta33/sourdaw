import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { ORIGINAL_HEAD, ORIGINAL_SPEC, ORIGINAL_SPEC_SHA256, ORIGINAL_TREE } from './identity.ts';
import { recordOf, requiredText } from './journal.ts';

export function gitRead(root: string, args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function assertPinnedSourceIdentity(head: string, tree: string, status: string, specSha256: string): void {
    if (head !== ORIGINAL_HEAD || tree !== ORIGINAL_TREE || status !== '') {
        throw new Error('Target must be the clean original CI merge and exact frozen tree');
    }
    if (specSha256 !== ORIGINAL_SPEC_SHA256) {
        throw new Error('Maintained case bytes changed');
    }
}

export function assertOriginalSource(root: string): Record<string, unknown> {
    if (realpathSync(root) !== resolve(root)) {
        throw new Error('Target source root must be its physical path');
    }
    const head = gitRead(root, ['rev-parse', 'HEAD']);
    const tree = gitRead(root, ['rev-parse', 'HEAD^{tree}']);
    const status = gitRead(root, ['status', '--porcelain', '--untracked-files=normal']);
    const paths = [
        ORIGINAL_SPEC,
        'playwright.config.ts',
        'scripts/e2eDevServer.ts',
        'tests/e2e/firstPaintWarmup.ts',
        'tests/e2e/e2eUtils.ts',
        'src/app/main.tsx',
        'src/app/App.tsx',
        'src/app/bootstrap.ts',
        'public/entryLoadRecovery.js',
        'package.json',
        'pnpm-lock.yaml',
    ];
    const files = Object.fromEntries(
        paths.map((path) => {
            const bytes = readFileSync(resolve(root, path));
            return [path, { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
        })
    );
    assertPinnedSourceIdentity(head, tree, status, files[ORIGINAL_SPEC]?.sha256 ?? '');
    return { head, tree, status, files };
}

export function installedPlaywrightVersion(root: string): string {
    const modules = resolve(root, 'node_modules');
    if (lstatSync(modules).isSymbolicLink() || realpathSync(modules) !== modules) {
        throw new Error('Target requires its own physical installed node_modules');
    }
    const value: unknown = JSON.parse(readFileSync(resolve(modules, '@playwright/test/package.json'), 'utf8'));
    return requiredText(recordOf(value, 'installed Playwright package').version, 'Playwright version');
}
