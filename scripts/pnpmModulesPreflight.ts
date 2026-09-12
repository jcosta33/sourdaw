/**
 * Shared pnpm install-metadata preflight (issue #4118).
 *
 * pnpm records the owning project inside the install itself: `node_modules/.pnpm-workspace-state-v1.json`
 * keeps a `projects` map keyed by absolute project path, and `node_modules/.modules.yaml` keeps the
 * install manifest (older releases record a `projectDir` there; pnpm 11 writes a JSON-shaped document
 * without one). When a lane's `node_modules` is a symlink into another checkout, every pnpm run through
 * the link resolves into the other checkout's install and rewrites both records with the lane's path.
 * The next pnpm run in the real owner then wants to remove `node_modules` and aborts without a TTY:
 * `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` — observed three times in production, each time killing
 * every trusted delivery script.
 *
 * Who runs this preflight, and why:
 * - `resourceGuard.ts` (`pnpm guard`): every local verification flows through the guard, so this is
 *   the refusal operators hit at the actual corruption route, before a wrapped command can write
 *   through a symlinked `node_modules`. It checks the checkout of the current working directory.
 * - `openLane.ts`: refuses to lock a freshly created lane whose `node_modules` already resolves
 *   outside the lane root (defense in depth; the link can also be created after opening, which the
 *   guard refusal above then catches on the next guarded run).
 *
 * `trustedGithubWriteBootstrap.ts` deliberately does NOT take this check: that loader is pinned by
 * `agentDeliveryScripts.spec.ts` as self-contained (no local imports), and in the corrupted-primary
 * scenario it is unreachable anyway — the outer `pnpm deliver` aborts at pnpm's own startup, before
 * node runs the launcher. The refusal lives where it can actually fire and print.
 *
 * The checks fail open when the evidence does not exist (no git checkout, no install, an unparseable
 * record): the preflight refuses the one known corruption signature, and pnpm itself surfaces
 * everything else. A plain `pnpm install` in the affected checkout rewrites both records correctly —
 * they are install outputs — which is why every refusal below prints that as the restore step.
 */

import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const PNPM_MODULES_DIR = 'node_modules';
export const PNPM_MODULES_MANIFEST = '.modules.yaml';
export const PNPM_WORKSPACE_STATE = '.pnpm-workspace-state-v1.json';

const MODULES_DIR_ABORT = 'ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY';
const LANE_INSTALL_ROUTE =
    "`pnpm install` run inside the lane is the sanctioned route to a lane's own dependency tree.";

/**
 * The project directory recorded in `.modules.yaml`, when the record has one. pnpm 11 writes the
 * manifest as a JSON document with no `projectDir`; older releases wrote a plain YAML mapping with
 * one. A successful JSON parse is the whole document, so the line scan below must not run over its
 * string contents — that is what keeps a `"note": "projectDir: /evil"` value from being read.
 */
export function modulesManifestProjectDir(source: string): string | undefined {
    try {
        const parsed: unknown = JSON.parse(source);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const projectDir = (parsed as Record<string, unknown>).projectDir;
            return typeof projectDir === 'string' && projectDir !== '' ? projectDir : undefined;
        }
        return undefined;
    } catch {
        // Not JSON: fall through to the YAML mapping form.
    }
    const match = /^["']?projectDir["']?\s*:\s*(.+)$/m.exec(source);
    if (match?.[1] === undefined) {
        return undefined;
    }
    const value = match[1].trim().replaceAll(/^['"]|['"]$/g, '');
    return value === '' ? undefined : value;
}

/**
 * The absolute project paths keyed into `.pnpm-workspace-state-v1.json`. Throws on unparseable
 * JSON; the callers own the fail-open decision.
 */
export function workspaceStateProjectDirs(source: string): string[] {
    const parsed: unknown = JSON.parse(source);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return [];
    }
    const projects = (parsed as Record<string, unknown>).projects;
    if (typeof projects !== 'object' || projects === null || Array.isArray(projects)) {
        return [];
    }
    return Object.keys(projects).filter((project) => project !== '');
}

/**
 * The data-driven refusal for one checkout: a foreign install record under
 * `<checkoutRoot>/node_modules` returns the message with the restore steps; a matching record,
 * a missing install, or an unreadable one returns undefined. `readFile` returning undefined
 * means absent or unreadable; `resolveExisting` canonically equates paths that differ only by
 * symlink, falling back to the literal spelling when a recorded path no longer exists.
 */
export function checkoutModulesRefusal(input: {
    checkoutRoot: string;
    readFile: (path: string) => string | undefined;
    resolveExisting?: (path: string) => string;
}): string | undefined {
    const resolveExisting = input.resolveExisting ?? realpathSync;
    const nodeModules = join(input.checkoutRoot, PNPM_MODULES_DIR);
    // The checkout that physically owns the install, wherever the read came through a link from:
    // the symlinked lane and the corrupted primary both resolve here, so the restore steps always
    // name the checkout where `pnpm install` actually repairs the metadata.
    const installOwner = dirname(canonicalPath(nodeModules, resolveExisting));

    const state = input.readFile(join(nodeModules, PNPM_WORKSPACE_STATE));
    if (state !== undefined) {
        try {
            const projects = workspaceStateProjectDirs(state);
            const owned = projects.some((project) =>
                sameDirectory(project, input.checkoutRoot, resolveExisting, nodeModules)
            );
            if (projects.length > 0 && !owned) {
                return foreignProjectMessage({
                    file: join(nodeModules, PNPM_WORKSPACE_STATE),
                    checkoutRoot: input.checkoutRoot,
                    recordedProject: projects[0] ?? '',
                    installOwner,
                });
            }
        } catch {
            // Unparseable state is pnpm's own repair job, not this preflight's refusal.
        }
    }

    const manifest = input.readFile(join(nodeModules, PNPM_MODULES_MANIFEST));
    if (manifest !== undefined) {
        const projectDir = modulesManifestProjectDir(manifest);
        if (projectDir !== undefined && !sameDirectory(projectDir, input.checkoutRoot, resolveExisting, nodeModules)) {
            return foreignProjectMessage({
                file: join(nodeModules, PNPM_MODULES_MANIFEST),
                checkoutRoot: input.checkoutRoot,
                recordedProject: projectDir,
                installOwner,
            });
        }
    }
    return undefined;
}

/**
 * The lane-side refusal `lane:open` prints: a `node_modules` that is a symlink resolving outside
 * the lane root would route every pnpm run into another checkout's install. Anything else — a
 * real directory, absent, or a link kept inside the lane — returns undefined.
 */
export function outsideSymlinkRefusal(input: {
    laneRoot: string;
    linkPath: string;
    linkTarget: string;
}): string | undefined {
    if (resolvesInside(input.laneRoot, input.linkTarget)) {
        return undefined;
    }
    return [
        `${input.laneRoot} was created, but ${input.linkPath} is a symlink to ${input.linkTarget}, outside the lane.`,
        `Every pnpm run through it rewrites the other checkout's install metadata, which later aborts trusted delivery scripts with ${MODULES_DIR_ABORT}.`,
        `Restore: remove ${input.linkPath} and run \`pnpm install\` in ${input.laneRoot}; the worktree this command created stays unlocked. ${LANE_INSTALL_ROUTE}`,
    ].join('\n');
}

/** Guard entry: refuse when the checkout of `cwd` holds another project's install record. */
export function assertCurrentCheckoutModulesBelongToCheckout(cwd: string): void {
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', shell: false });
    if (result.error !== undefined || result.status !== 0) {
        return;
    }
    const toplevel = result.stdout.trim();
    if (toplevel === '') {
        return;
    }
    assertCheckoutModulesBelongToCheckout(canonicalPath(toplevel, realpathSync));
}

/** Refuse when `checkoutRoot` holds another project's install record; silent when it does not. */
export function assertCheckoutModulesBelongToCheckout(checkoutRoot: string): void {
    const refusal = checkoutModulesRefusal({ checkoutRoot, readFile: readTextFile });
    if (refusal !== undefined) {
        throw new Error(refusal);
    }
}

/**
 * `lane:open`'s port adapter: the resolved target when the lane's `node_modules` is a symlink,
 * undefined when it is absent or a real directory.
 */
export function nodeModulesLinkTarget(laneRoot: string): string | undefined {
    const linkPath = join(laneRoot, PNPM_MODULES_DIR);
    try {
        if (!lstatSync(linkPath).isSymbolicLink()) {
            return undefined;
        }
        return realpathSync(linkPath);
    } catch {
        return undefined;
    }
}

function foreignProjectMessage(input: {
    file: string;
    checkoutRoot: string;
    recordedProject: string;
    installOwner: string;
}): string {
    return [
        `${input.file} records pnpm project ${input.recordedProject}, not this checkout (${input.checkoutRoot}).`,
        `A node_modules symlinked from a lane rewrites this install metadata on every pnpm run, and the next pnpm run in the real owner aborts with ${MODULES_DIR_ABORT}.`,
        `Restore: remove the lane's ${PNPM_MODULES_DIR} symlink, then run \`pnpm install\` in ${input.installOwner} to rewrite the install metadata for the checkout that physically owns it. ${LANE_INSTALL_ROUTE}`,
    ].join('\n');
}

/**
 * Relative recorded paths resolve against the `node_modules` directory they live in, the same
 * base pnpm uses for relative records like `virtualStoreDir: .pnpm`.
 */
function sameDirectory(
    recorded: string,
    checkoutRoot: string,
    resolveExisting: (path: string) => string,
    recordBase: string
): boolean {
    const absolute = isAbsolute(recorded) ? recorded : resolve(recordBase, recorded);
    return canonicalPath(absolute, resolveExisting) === canonicalPath(checkoutRoot, resolveExisting);
}

function resolvesInside(root: string, target: string): boolean {
    const relativePath = relative(canonicalPath(root, realpathSync), canonicalPath(target, realpathSync));
    return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function canonicalPath(path: string, resolveExisting: (path: string) => string): string {
    try {
        return resolveExisting(path);
    } catch {
        // A recorded path that no longer exists compares by its literal normalized spelling.
        return resolve(path);
    }
}

function readTextFile(path: string): string | undefined {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return undefined;
    }
}
