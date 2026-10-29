#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { cleanupDirectory } from './cleanupLanes.ts';
import { githubAuthorizationGitEnv, resolvePrimaryRoot } from './githubAppIdentity.ts';
import { BOOTSTRAP_PATH, snapshotImportSpecifiers, trustedLocalImportClosure } from './trustedGithubWriteBootstrap.ts';

export const CLEANUP_LABEL = 'com.sourdaw.lane-cleanup';
const WORKER = 'scripts/cleanupLanes.ts';
const PACKAGE = '{"type":"module"}\n';
export type CleanupInstallationPort = {
    primaryRoot: string;
    platform: NodeJS.Platform;
    uid: number;
    home: string;
    node: string;
    git: string;
    gh: string;
    capture: (command: string, args: string[]) => string;
    run: (command: string, args: string[]) => void;
};
export type CleanupRuntimeBinding = {
    version: 1;
    primaryRoot: string;
    commit: string;
    node: string;
    git: string;
    gh: string;
    sources: Array<{ path: string; hash: string }>;
};

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function sourcePath(path: string): void {
    if (!/^scripts\/[A-Za-z0-9_-]+\.ts$/.test(path)) {
        throw new Error('cleanup runtime contains an unsafe source path');
    }
}

function atomicWrite(path: string, contents: string, mode = 0o600): void {
    const candidate = `${path}.${randomUUID()}.candidate`;
    writeFileSync(candidate, contents, { flag: 'wx', mode });
    renameSync(candidate, path);
}

/** All authority is embedded in launchd arguments, outside the mutable runtime directory. */
export function cleanupRuntimeProgram(binding: CleanupRuntimeBinding, runtime: string): string {
    for (const source of binding.sources) {
        sourcePath(source.path);
    }
    return `
const fs = require('node:fs');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');
const url = require('node:url');
const binding = ${JSON.stringify(binding)};
const runtime = ${JSON.stringify(runtime)};
const env = { ...process.env };
for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_') || key.startsWith('NODE_') || key.startsWith('SOURDAW_TRUSTED_')) delete env[key];
}
env.GIT_CONFIG_NOSYSTEM = '1'; env.GIT_CONFIG_GLOBAL = '/dev/null'; env.GIT_TERMINAL_PROMPT = '0';
const git = (args) => cp.execFileSync(binding.git, ['-C', binding.primaryRoot, ...args], { env, encoding: 'utf8' });
const regular = (file) => { const st = fs.lstatSync(file); if (!st.isFile() || st.isSymbolicLink()) throw Error('cleanup runtime file is not regular'); };
if (fs.realpathSync(binding.primaryRoot) !== binding.primaryRoot || fs.realpathSync(runtime) !== runtime ||
    path.dirname(path.dirname(runtime)) !== path.join(binding.primaryRoot, '.agents', 'lane-cleanup')) throw Error('cleanup runtime root changed');
const registry = git(['worktree', 'list', '--porcelain', '-z']);
if (registry.split('\\0')[0] !== 'worktree ' + binding.primaryRoot) throw Error('cleanup primary registry changed');
const origin = git(['remote', 'get-url', 'origin']).trim();
if (!['https://github.com/jcosta33/sourdaw.git', 'git@github.com:jcosta33/sourdaw.git'].includes(origin)) throw Error('cleanup origin changed');
git(['merge-base', '--is-ancestor', binding.commit, 'origin/main']);
regular(path.join(runtime, 'manifest.json'));
if (fs.readFileSync(path.join(runtime, 'manifest.json'), 'utf8') !== JSON.stringify(binding) + '\\n') throw Error('cleanup manifest changed');
regular(path.join(runtime, 'package.json'));
if (fs.readFileSync(path.join(runtime, 'package.json'), 'utf8') !== ${JSON.stringify(PACKAGE)}) throw Error('cleanup package changed');
const allowed = new Set(binding.sources.map((source) => source.path.split('/')[1]));
if (fs.readdirSync(path.join(runtime, 'scripts')).some((name) => !allowed.has(name))) throw Error('cleanup runtime contains unexpected source');
for (const source of binding.sources) {
    if (!/^scripts\\/[A-Za-z0-9_-]+\\.ts$/.test(source.path)) throw Error('cleanup runtime source path changed');
    const file = path.join(runtime, source.path); regular(file);
    const bytes = fs.readFileSync(file, 'utf8');
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== source.hash ||
        bytes !== git(['show', binding.commit + ':' + source.path])) throw Error('cleanup runtime source changed');
}
process.chdir(binding.primaryRoot);
process.env.SOURDAW_TRUSTED_GIT_PATH = binding.git;
process.env.SOURDAW_TRUSTED_GH_PATH = binding.gh;
import(url.pathToFileURL(path.join(runtime, ${JSON.stringify(WORKER)})).href)
    .then(async (worker) => {
        try { await worker.runCleanup(binding.primaryRoot); }
        catch (error) { console.error(worker.cleanupFailureReason(error)); process.exitCode = 1; }
    })
    .catch(() => { console.error('verified cleanup runtime could not be loaded'); process.exitCode = 1; });
`.trim();
}

function xml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function cleanupPlist(binding: CleanupRuntimeBinding, runtime: string): string {
    const args = [binding.node, '--no-warnings', '-e', cleanupRuntimeProgram(binding, runtime)];
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${CLEANUP_LABEL}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(binding.primaryRoot)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml([dirname(binding.git), dirname(binding.gh), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'))}</string><key>NODE_OPTIONS</key><string></string><key>NODE_PATH</key><string></string></dict>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>300</integer>
<key>StandardOutPath</key><string>${xml(join(binding.primaryRoot, '.agents/lane-cleanup/worker.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(binding.primaryRoot, '.agents/lane-cleanup/worker-error.log'))}</string>
</dict></plist>\n`;
}

function canonicalLauncherPath(primaryRoot: string, directory: string): string {
    if (directory !== join(primaryRoot, '.agents/lane-cleanup')) {
        throw new Error('protected primary launcher requires its canonical installation directory');
    }
    for (const parent of [primaryRoot, join(primaryRoot, dirname(BOOTSTRAP_PATH)), directory]) {
        const stat = lstatSync(parent);
        if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(parent) !== parent) {
            throw new Error('protected primary launcher requires canonical parent directories');
        }
    }
    const path = join(primaryRoot, BOOTSTRAP_PATH);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || realpathSync(path) !== path) {
        throw new Error('protected primary launcher must be a canonical regular file');
    }
    return path;
}

/** Refresh only the clean canonical launcher, or the exact blob this installer previously owned. */
export function refreshCleanupLauncher(port: CleanupInstallationPort, commit: string, directory: string): void {
    const path = canonicalLauncherPath(port.primaryRoot, directory);
    const next = port.capture(port.git, ['show', `${commit}:${BOOTSTRAP_PATH}`]);
    const current = readFileSync(path, 'utf8');
    const receiptPath = join(directory, 'launcher-installation.json');
    type InstalledBlob = { commit: string; hash: string };
    let receipt: (InstalledBlob & { previous?: InstalledBlob }) | undefined;
    if (existsSync(receiptPath)) {
        if (!lstatSync(receiptPath).isFile() || lstatSync(receiptPath).isSymbolicLink()) {
            throw new Error('protected primary launcher installation receipt is not regular');
        }
        receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as InstalledBlob & { previous?: InstalledBlob };
    }
    const head = port.capture(port.git, ['show', `HEAD:${BOOTSTRAP_PATH}`]);
    const index = port.capture(port.git, ['show', `:${BOOTSTRAP_PATH}`]);
    const installed = [receipt, receipt?.previous].find((previous) => {
        if (previous === undefined || !/^[a-f0-9]{40}$/.test(previous.commit) || hash(current) !== previous.hash) {
            return false;
        }
        port.capture(port.git, ['merge-base', '--is-ancestor', previous.commit, commit]);
        return port.capture(port.git, ['show', `${previous.commit}:${BOOTSTRAP_PATH}`]) === current;
    });
    const previouslyInstalled = installed !== undefined;
    if ((current !== head && !previouslyInstalled) || index !== head) {
        throw new Error('protected primary launcher has local changes; refusing to overwrite it');
    }
    canonicalLauncherPath(port.primaryRoot, directory);
    if (readFileSync(path, 'utf8') !== current) {
        throw new Error('protected primary launcher changed during installation');
    }
    if (current !== next) {
        // Record both the approved replacement and its origin before publication, so interruption is recoverable.
        const installation: InstalledBlob & { previous?: InstalledBlob } = { commit, hash: hash(next) };
        if (installed !== undefined) {
            installation.previous = { commit: installed.commit, hash: installed.hash };
        }
        atomicWrite(receiptPath, `${JSON.stringify(installation)}\n`);
        atomicWrite(path, next, statSync(path).mode & 0o777);
    } else {
        atomicWrite(receiptPath, `${JSON.stringify({ commit, hash: hash(next) })}\n`);
    }
}

export function installCleanupLanes(port: CleanupInstallationPort): { plist: string; runtime: string } {
    if (port.platform !== 'darwin') {
        throw new Error('lane cleanup installation requires macOS launchd');
    }
    if (
        !Number.isSafeInteger(port.uid) ||
        port.uid < 0 ||
        [port.node, port.git, port.gh, port.primaryRoot, port.home].some((path) => !isAbsolute(path))
    ) {
        throw new Error('cleanup installation requires absolute executable and repository paths');
    }
    const root = realpathSync(port.primaryRoot);
    if (
        port.capture(port.git, ['worktree', 'list', '--porcelain', '-z']).split('\0')[0] !== `worktree ${root}` ||
        !['https://github.com/jcosta33/sourdaw.git', 'git@github.com:jcosta33/sourdaw.git'].includes(
            port.capture(port.git, ['remote', 'get-url', 'origin']).trim()
        )
    ) {
        throw new Error('cleanup installation requires the protected primary repository');
    }
    const commit = port.capture(port.git, ['rev-parse', 'origin/main^{commit}']).trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) {
        throw new Error('cleanup installation requires an approved origin/main commit');
    }
    const source = (path: string) => port.capture(port.git, ['show', `${commit}:${path}`]);
    const paths = [...trustedLocalImportClosure(WORKER, source)].sort();
    const sources = paths.map((path) => {
        sourcePath(path);
        const contents = source(path);
        if (
            snapshotImportSpecifiers(contents).some(
                (specifier) => !specifier.startsWith('node:') && !specifier.startsWith('./')
            )
        ) {
            throw new Error('cleanup runtime may use only verified sibling sources and Node builtins');
        }
        return { path, hash: hash(contents) };
    });
    const directory = cleanupDirectory(root);
    const runtimes = join(directory, 'runtimes');
    mkdirSync(runtimes, { recursive: true, mode: 0o700 });
    if (
        !lstatSync(runtimes).isDirectory() ||
        lstatSync(runtimes).isSymbolicLink() ||
        realpathSync(runtimes) !== runtimes
    ) {
        throw new Error('cleanup runtime directory is not inside the primary checkout');
    }
    for (const name of ['worker.log', 'worker-error.log']) {
        const path = join(directory, name);
        if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) {
            throw new Error('cleanup log path is not a regular file');
        }
    }
    const runtime = join(runtimes, `${commit}-${randomUUID()}`);
    mkdirSync(join(runtime, 'scripts'), { recursive: true, mode: 0o700 });
    for (const path of paths) {
        writeFileSync(join(runtime, path), source(path), { flag: 'wx', mode: 0o600 });
    }
    const binding: CleanupRuntimeBinding = {
        version: 1,
        primaryRoot: root,
        commit,
        node: realpathSync(port.node),
        git: realpathSync(port.git),
        gh: realpathSync(port.gh),
        sources,
    };
    writeFileSync(join(runtime, 'package.json'), PACKAGE, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(runtime, 'manifest.json'), `${JSON.stringify(binding)}\n`, { flag: 'wx', mode: 0o600 });
    refreshCleanupLauncher(port, commit, directory);
    const agents = join(port.home, 'Library/LaunchAgents');
    mkdirSync(agents, { recursive: true });
    const plist = join(agents, `${CLEANUP_LABEL}.plist`);
    atomicWrite(plist, cleanupPlist(binding, runtime));
    const service = `gui/${port.uid}/${CLEANUP_LABEL}`;
    let loaded = false;
    try {
        port.capture('/bin/launchctl', ['print', service]);
        loaded = true;
    } catch (error) {
        if (!(error instanceof Error) || !/Could not find service|service not found/i.test(error.message)) {
            throw error;
        }
    }
    if (loaded) {
        port.run('/bin/launchctl', ['bootout', service]);
    }
    port.run('/bin/launchctl', ['bootstrap', `gui/${port.uid}`, plist]);
    port.capture('/bin/launchctl', ['print', service]);
    return { plist, runtime };
}

function main(): void {
    if (process.argv.length !== 2) {
        throw new Error('usage: pnpm lane:cleanup:install');
    }
    const root = resolvePrimaryRoot();
    const git = realpathSync(execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim());
    const gh = realpathSync(execFileSync('/usr/bin/which', ['gh'], { encoding: 'utf8' }).trim());
    const capture = (command: string, args: string[]) =>
        execFileSync(command, args, {
            cwd: root,
            env: githubAuthorizationGitEnv(),
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
        });
    const commit = capture(git, ['rev-parse', 'origin/main^{commit}']).trim();
    // Installation code and its parser must themselves be the approved sources, even from a lane.
    const entry = fileURLToPath(import.meta.url);
    const sourceRoot = dirname(dirname(entry));
    for (const path of trustedLocalImportClosure('scripts/installCleanupLanes.ts', (path) =>
        capture(git, ['show', `${commit}:${path}`])
    )) {
        if (readFileSync(join(sourceRoot, path), 'utf8') !== capture(git, ['show', `${commit}:${path}`])) {
            throw new Error('cleanup installer does not match approved origin/main sources');
        }
    }
    const result = installCleanupLanes({
        primaryRoot: root,
        platform: process.platform,
        uid: process.getuid?.() ?? -1,
        home: homedir(),
        node: process.execPath,
        git,
        gh,
        capture,
        run: (command, args) => {
            capture(command, args);
        },
    });
    console.log(`Installed ${result.plist}; verified runtime ${pathToFileURL(result.runtime).pathname}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
