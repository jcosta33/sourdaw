import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    PNPM_MODULES_MANIFEST,
    PNPM_MODULES_DIR,
    PNPM_WORKSPACE_STATE,
    assertCheckoutModulesBelongToCheckout,
    assertCurrentCheckoutModulesBelongToCheckout,
    checkoutModulesRefusal,
    modulesManifestProjectDir,
    nodeModulesLinkTarget,
    outsideSymlinkRefusal,
    workspaceStateProjectDirs,
} from '../pnpmModulesPreflight.ts';

const RESTORE_PATTERN = /Restore: remove the lane's node_modules symlink, then run `pnpm install` in /;

function mapFilesystem(files: Record<string, string | undefined>): (path: string) => string | undefined {
    return (path) => files[path];
}

function workspaceStateSource(...projects: string[]): string {
    return JSON.stringify({ projects: Object.fromEntries(projects.map((project) => [project, { name: 'sourdaw' }])) });
}

describe('modulesManifestProjectDir', () => {
    it('reads a JSON-shaped manifest projectDir', () => {
        expect(modulesManifestProjectDir(JSON.stringify({ layoutVersion: 5, projectDir: '/repo' }))).toBe('/repo');
    });

    it('reads a plain YAML mapping projectDir, quoted or bare', () => {
        expect(modulesManifestProjectDir('layoutVersion: 5\nprojectDir: /repo\n')).toBe('/repo');
        expect(modulesManifestProjectDir("layoutVersion: 5\nprojectDir: '/repo with space'\n")).toBe(
            '/repo with space'
        );
    });

    it('returns undefined when the record names no project', () => {
        expect(modulesManifestProjectDir(JSON.stringify({ layoutVersion: 5 }))).toBeUndefined();
        expect(modulesManifestProjectDir('layoutVersion: 5\nstoreDir: /store\n')).toBeUndefined();
        expect(modulesManifestProjectDir('')).toBeUndefined();
    });

    it('never reads a projectDir out of a JSON string value', () => {
        expect(modulesManifestProjectDir(JSON.stringify({ note: 'projectDir: /evil' }))).toBeUndefined();
    });
});

describe('workspaceStateProjectDirs', () => {
    it('lists the recorded project paths', () => {
        expect(workspaceStateProjectDirs(workspaceStateSource('/repo', '/other'))).toEqual(['/repo', '/other']);
    });

    it('returns empty when the state records no projects', () => {
        expect(workspaceStateProjectDirs('{}')).toEqual([]);
        expect(workspaceStateProjectDirs(JSON.stringify({ projects: {} }))).toEqual([]);
        expect(workspaceStateProjectDirs(JSON.stringify({ projects: 'garbage' }))).toEqual([]);
    });

    it('throws on unparseable JSON, leaving the fail-open decision to the caller', () => {
        expect(() => workspaceStateProjectDirs('not json')).toThrow();
    });
});

describe('checkoutModulesRefusal', () => {
    const checkoutRoot = '/repo';

    it('passes an install whose workspace state records this checkout', () => {
        const files = { [`/repo/${PNPM_MODULES_DIR}/${PNPM_WORKSPACE_STATE}`]: workspaceStateSource('/repo') };
        expect(checkoutModulesRefusal({ checkoutRoot, readFile: mapFilesystem(files) })).toBeUndefined();
    });

    it('refuses an install whose workspace state records another project, with the restore steps', () => {
        const statePath = `/repo/${PNPM_MODULES_DIR}/${PNPM_WORKSPACE_STATE}`;
        const files = { [statePath]: workspaceStateSource('/lanes/agent-7-work') };

        const refusal = checkoutModulesRefusal({ checkoutRoot, readFile: mapFilesystem(files) });

        expect(refusal).toMatch(
            new RegExp(`^${statePath} records pnpm project /lanes/agent-7-work, not this checkout \\(/repo\\)`)
        );
        expect(refusal).toMatch(/ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY/);
        expect(refusal).toMatch(RESTORE_PATTERN);
        expect(refusal).toMatch(/run `pnpm install` in \/repo to rewrite the install metadata/);
        expect(refusal).toMatch(/`pnpm install` run inside the lane is the sanctioned route/);
    });

    it('refuses a manifest projectDir outside the checkout, in either record format', () => {
        const manifestPath = `/repo/${PNPM_MODULES_DIR}/${PNPM_MODULES_MANIFEST}`;
        const files = { [manifestPath]: JSON.stringify({ projectDir: '/lanes/agent-7-work' }) };
        expect(checkoutModulesRefusal({ checkoutRoot, readFile: mapFilesystem(files) })).toMatch(
            /records pnpm project \/lanes\/agent-7-work/
        );

        const yamlFiles = { [manifestPath]: 'layoutVersion: 4\nprojectDir: /lanes/agent-7-work\n' };
        expect(checkoutModulesRefusal({ checkoutRoot, readFile: mapFilesystem(yamlFiles) })).toMatch(
            /records pnpm project \/lanes\/agent-7-work/
        );
    });

    it('passes a manifest projectDir equal to the checkout', () => {
        const files = {
            [`/repo/${PNPM_MODULES_DIR}/${PNPM_MODULES_MANIFEST}`]: JSON.stringify({ projectDir: '/repo' }),
        };
        expect(checkoutModulesRefusal({ checkoutRoot, readFile: mapFilesystem(files) })).toBeUndefined();
    });

    it('passes when there is no install, or an install with no recorded project, to read', () => {
        expect(checkoutModulesRefusal({ checkoutRoot, readFile: mapFilesystem({}) })).toBeUndefined();
        expect(
            checkoutModulesRefusal({
                checkoutRoot,
                readFile: mapFilesystem({
                    [`/repo/${PNPM_MODULES_DIR}/${PNPM_MODULES_MANIFEST}`]: JSON.stringify({ layoutVersion: 5 }),
                    [`/repo/${PNPM_MODULES_DIR}/${PNPM_WORKSPACE_STATE}`]: JSON.stringify({ projects: {} }),
                }),
            })
        ).toBeUndefined();
    });

    it('fails open on an unparseable workspace state', () => {
        const files = { [`/repo/${PNPM_MODULES_DIR}/${PNPM_WORKSPACE_STATE}`]: 'not json at all' };
        expect(checkoutModulesRefusal({ checkoutRoot, readFile: mapFilesystem(files) })).toBeUndefined();
    });

    it('equates a recorded path with the checkout through a symlink alias', () => {
        const files = {
            [`/repo/${PNPM_MODULES_DIR}/${PNPM_WORKSPACE_STATE}`]: workspaceStateSource('/var/repo-alias'),
        };
        const refusal = checkoutModulesRefusal({
            checkoutRoot: '/repo',
            readFile: mapFilesystem(files),
            resolveExisting: (path) => (path === '/var/repo-alias' || path === '/repo' ? '/real/repo' : path),
        });
        expect(refusal).toBeUndefined();
    });

    it('resolves a relative recorded projectDir against the node_modules directory', () => {
        const files = { [`/repo/${PNPM_MODULES_DIR}/${PNPM_MODULES_MANIFEST}`]: 'projectDir: ..\n' };
        expect(checkoutModulesRefusal({ checkoutRoot, readFile: mapFilesystem(files) })).toBeUndefined();

        const nested = { [`/repo/nested/${PNPM_MODULES_DIR}/${PNPM_MODULES_MANIFEST}`]: 'projectDir: ../..\n' };
        expect(checkoutModulesRefusal({ checkoutRoot: '/repo/nested', readFile: mapFilesystem(nested) })).toMatch(
            /records pnpm project \.\.\/\.\./
        );
    });
});

describe('outsideSymlinkRefusal', () => {
    const laneRoot = '/repo/.agents/worktrees/agent-7-work';

    it('refuses a link resolving outside the lane, naming the link, the target, and the route', () => {
        const refusal = outsideSymlinkRefusal({
            laneRoot,
            linkPath: `${laneRoot}/node_modules`,
            linkTarget: '/repo/node_modules',
        });

        expect(refusal).toMatch(
            new RegExp(
                `^${laneRoot} was created, but ${laneRoot}/node_modules is a symlink to /repo/node_modules, outside the lane`
            )
        );
        expect(refusal).toMatch(/ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY/);
        expect(refusal).toMatch(
            new RegExp(`Restore: remove ${laneRoot}/node_modules and run \`pnpm install\` in ${laneRoot}`)
        );
    });

    it('passes a link kept inside the lane', () => {
        expect(
            outsideSymlinkRefusal({
                laneRoot,
                linkPath: `${laneRoot}/node_modules`,
                linkTarget: `${laneRoot}/vendor/store`,
            })
        ).toBeUndefined();
    });
});

describe('pnpm modules preflight against a real filesystem', () => {
    const parents: string[] = [];

    function tempCheckout(label: string): string {
        const root = realpathSync(mkdtempSync(join(tmpdir(), `sourdaw-pnpm-preflight-${label}-`)));
        parents.push(root);
        return root;
    }

    function writeInstallState(root: string, recordedProject: string): string {
        const nodeModules = join(root, PNPM_MODULES_DIR);
        mkdirSync(nodeModules);
        writeFileSync(join(nodeModules, PNPM_WORKSPACE_STATE), workspaceStateSource(recordedProject));
        return nodeModules;
    }

    afterEach(() => {
        // rmSync never follows symlinks: the lane's link is unlinked, the primary install survives.
        for (const parent of parents.splice(0)) {
            rmSync(parent, { recursive: true, force: true });
        }
    });

    it('refuses a lane whose node_modules symlinks into the primary checkout', () => {
        const primaryRoot = tempCheckout('primary');
        const primaryNodeModules = writeInstallState(primaryRoot, primaryRoot);

        const laneRoot = tempCheckout('lane');
        symlinkSync(primaryNodeModules, join(laneRoot, PNPM_MODULES_DIR));

        expect(nodeModulesLinkTarget(laneRoot)).toBe(primaryNodeModules);
        expect(() => assertCheckoutModulesBelongToCheckout(laneRoot)).toThrow(
            /records pnpm project .*not this checkout/
        );
        expect(() => assertCheckoutModulesBelongToCheckout(laneRoot)).toThrow(
            new RegExp(`pnpm install\` in ${primaryRoot.replaceAll('/', '\\/')}`)
        );
        expect(() => assertCheckoutModulesBelongToCheckout(primaryRoot)).not.toThrow();
    });

    it('passes a lane with its own install and a checkout with no install', () => {
        const laneRoot = tempCheckout('own-install');
        writeInstallState(laneRoot, laneRoot);
        expect(() => assertCheckoutModulesBelongToCheckout(laneRoot)).not.toThrow();

        const bareRoot = tempCheckout('bare');
        expect(nodeModulesLinkTarget(bareRoot)).toBeUndefined();
        expect(() => assertCheckoutModulesBelongToCheckout(bareRoot)).not.toThrow();
    });

    it('stands down outside a git checkout instead of blocking the guard', () => {
        expect(() => assertCurrentCheckoutModulesBelongToCheckout(tempCheckout('non-repo'))).not.toThrow();
    });
});
