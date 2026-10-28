import { spawnSync } from 'node:child_process';
import {
    appendFileSync,
    copyFileSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    realpathSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const registry = 'https://registry.npmjs.org/';
const bootstrapDirectory = resolve(import.meta.dirname, '../.github/actions/setup-pnpm/bootstrap');

type CommandOptions = { cwd: string; env: NodeJS.ProcessEnv };
type CommandResult = { status: number | null; stdout: string };
export type SetupPnpmOptions = {
    workspace: string;
    manifest: string;
    dest?: string;
    env: NodeJS.ProcessEnv;
    node: string;
    platform?: NodeJS.Platform;
    run?: (file: string, args: string[], options: CommandOptions) => CommandResult;
};

function nativeCommand(file: string, args: string[], options: CommandOptions): CommandResult {
    const result = spawnSync(file, args, {
        ...options,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) {
        throw result.error;
    }
    return { status: result.status, stdout: result.stdout ?? '' };
}

function canonicalRegistry(value: string): boolean {
    try {
        const url = new URL(value);
        return url.href === registry;
    } catch {
        return false;
    }
}

function assertSafeEnvironment(env: NodeJS.ProcessEnv): void {
    for (const [name, value] of Object.entries(env)) {
        if (!value) {
            continue;
        }
        const key = name.toLowerCase().replaceAll(/[_-]/g, '');
        if (
            (key === 'nodetlsrejectunauthorized' && value !== '1') ||
            (key.endsWith('strictssl') && value !== 'true') ||
            key.includes('packagemanagerregistries') ||
            key.includes('packagemanagernetworkconfig') ||
            key.endsWith('pmonfail') ||
            key === 'corepackintegritykeys' ||
            ((key === 'npmconfigregistry' || key === 'pnpmconfigregistry') && !canonicalRegistry(value))
        ) {
            throw new Error(`pnpm setup refuses security-changing environment variable ${name}`);
        }
    }
}

function targetVersion(workspace: string, manifest: string): string {
    const requested = resolve(workspace, manifest);
    if (!within(workspace, requested)) {
        throw new Error('pnpm manifest must belong to the workspace');
    }
    const file = realpathSync(requested);
    if (!within(workspace, file)) {
        throw new Error('pnpm manifest must belong to the workspace');
    }
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Invalid pnpm manifest');
    }
    const declaration: unknown = Reflect.get(data, 'packageManager');
    if (typeof declaration !== 'string' || !/^pnpm@(11\.\d+\.\d+)$/.test(declaration)) {
        throw new Error('pnpm setup requires an exact JavaScript pnpm 11 packageManager declaration');
    }
    if (Reflect.get(data, 'devEngines') !== undefined) {
        const devEngines: unknown = Reflect.get(data, 'devEngines');
        if (devEngines !== null && typeof devEngines === 'object' && Reflect.has(devEngines, 'packageManager')) {
            throw new Error('pnpm setup requires one packageManager declaration');
        }
    }
    return declaration.slice('pnpm@'.length);
}

function within(root: string, path: string): boolean {
    const child = relative(root, path);
    return child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function prepareDestination(dest: string | undefined, env: NodeJS.ProcessEnv, workspace: string): string {
    // The stable per-job path keeps setup-node's store-cache archive path stable.
    // An existing nonempty directory is refused rather than reused or deleted.
    const candidate = dest || join(env.RUNNER_TEMP ?? tmpdir(), 'sourdaw-pnpm');
    if (!isAbsolute(candidate) || /[\r\n]/.test(candidate)) {
        throw new Error('pnpm destination must be an absolute path');
    }
    let stat;
    let root: string;
    try {
        stat = lstatSync(candidate);
        if (stat.isSymbolicLink()) {
            throw new Error('pnpm destination must be an empty owned directory with mode 0755');
        }
        root = realpathSync(candidate);
    } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
            throw error;
        }
        root = join(realpathSync(dirname(candidate)), basename(candidate));
    }
    if (within(workspace, root)) {
        throw new Error('pnpm destination must be outside the project workspace');
    }
    if (stat === undefined) {
        mkdirSync(root, { mode: 0o755 });
        stat = lstatSync(root);
    }
    if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (process.getuid !== undefined && stat.uid !== process.getuid()) ||
        (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o755) ||
        readdirSync(root).length > 0
    ) {
        throw new Error('pnpm destination must be an empty owned directory with mode 0755');
    }
    return root;
}

function isolatedEnvironment(env: NodeJS.ProcessEnv, root: string): NodeJS.ProcessEnv {
    const safe = Object.fromEntries(
        Object.entries(env).filter(([name]) => !/^(npm_|pnpm_|corepack_|node_options$|node_path$)/i.test(name))
    );
    const config = join(root, 'config');
    mkdirSync(config);
    mkdirSync(join(root, 'runtime'));
    const userConfig = join(config, 'user.npmrc');
    const globalConfig = join(config, 'global.npmrc');
    writeFileSync(userConfig, '');
    writeFileSync(globalConfig, '');
    return {
        ...safe,
        XDG_CONFIG_HOME: config,
        XDG_CACHE_HOME: join(root, 'cache'),
        XDG_STATE_HOME: join(root, 'state'),
        NPM_CONFIG_USERCONFIG: userConfig,
        NPM_CONFIG_GLOBALCONFIG: globalConfig,
        NPM_CONFIG_CACHE: join(root, 'npm-cache'),
        NPM_CONFIG_REGISTRY: registry,
        NPM_CONFIG_STRICT_SSL: 'true',
        PNPM_HOME: join(root, 'runtime'),
        PNPM_CONFIG_STORE_DIR: join(root, 'store'),
    };
}

function installedEntrypoint(dest: string, bin: string, version: string): string {
    // pnpm's linker writes this marker on every platform, and self-update itself
    // uses it to identify installed shim targets. Execute the JS with known Node
    // so Windows never needs a terminal to launch a .cmd file.
    const marker = readFileSync(join(bin, 'pnpm'), 'utf8').match(/^#\s*cmd-shim-target=(.+)$/m)?.[1];
    if (!marker) {
        throw new Error('pnpm target shim has no installed entrypoint');
    }
    const entrypoint = realpathSync(resolve(bin, marker));
    if (
        (!within(join(dest, 'runtime'), entrypoint) && !within(join(dest, 'store'), entrypoint)) ||
        basename(entrypoint) !== 'pnpm.mjs'
    ) {
        throw new Error('pnpm target entrypoint must belong to its independent installation');
    }
    const manifest: unknown = JSON.parse(readFileSync(join(dirname(entrypoint), '../package.json'), 'utf8'));
    if (
        manifest === null ||
        typeof manifest !== 'object' ||
        Reflect.get(manifest, 'name') !== 'pnpm' ||
        Reflect.get(manifest, 'version') !== version
    ) {
        throw new Error('pnpm target package identity does not match the requested release');
    }
    return entrypoint;
}

export function setupPnpm(options: SetupPnpmOptions): { bin: string; dest: string; version: string } {
    assertSafeEnvironment(options.env);
    const workspace = realpathSync(options.workspace);
    const version = targetVersion(workspace, options.manifest);
    const dest = prepareDestination(options.dest, options.env, workspace);
    const bootstrap = join(dest, 'bootstrap');
    mkdirSync(bootstrap);
    // pnpm 11.26 verifies the selected engine, so unused native signatures cannot
    // block a JavaScript target (#5806). This reviewed repository lock replaces the external action's bootstrap
    // byte pin. It authenticates the already signature-checked official release;
    // target signature verification remains a separate runtime pnpm operation.
    for (const file of ['package.json', 'package-lock.json']) {
        copyFileSync(join(bootstrapDirectory, file), join(bootstrap, file));
    }
    const env = isolatedEnvironment(options.env, dest);
    const run = options.run ?? nativeCommand;
    const command = (file: string, args: string[], label: string): string => {
        const result = run(file, args, { cwd: bootstrap, env });
        if (result.status !== 0) {
            throw new Error(`pnpm setup ${label} failed (status ${result.status ?? 'unavailable'})`);
        }
        return result.stdout.trim();
    };
    const nodeDirectory = dirname(options.node);
    let npmEntrypoint: string;
    if ((options.platform ?? process.platform) === 'win32') {
        npmEntrypoint = join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js');
    } else {
        npmEntrypoint = resolve(nodeDirectory, '../lib/node_modules/npm/bin/npm-cli.js');
    }
    command(
        options.node,
        [npmEntrypoint, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
        'bootstrap installation'
    );
    command(
        options.node,
        [join(bootstrap, 'node_modules/pnpm/bin/pnpm.mjs'), 'self-update', version],
        'verified target installation'
    );
    const home = join(dest, 'runtime');
    const bin = join(home, 'bin');
    const target = installedEntrypoint(dest, bin, version);
    const actual = command(options.node, [target, '--version'], 'target version check');
    if (actual !== version) {
        throw new Error(`pnpm setup target reports ${actual}, expected ${version}`);
    }
    const { GITHUB_PATH, GITHUB_ENV, GITHUB_OUTPUT } = options.env;
    if (!GITHUB_PATH || !GITHUB_ENV || !GITHUB_OUTPUT) {
        throw new Error('pnpm setup requires GitHub output files');
    }
    appendFileSync(GITHUB_PATH, `${bin}\n`);
    appendFileSync(GITHUB_ENV, `PNPM_HOME=${home}\n`);
    appendFileSync(GITHUB_OUTPUT, `dest=${dest}\nbin_dest=${bin}\n`);
    return { bin, dest, version };
}

export function preparePnpmNode(node: string): string[] {
    const nodeBin = dirname(node);
    let corepackDist: string;
    if (process.platform === 'win32') {
        corepackDist = join(nodeBin, 'node_modules/corepack/dist');
    } else {
        corepackDist = resolve(nodeBin, '../lib/node_modules/corepack/dist');
    }
    const extensions = process.platform === 'win32' ? ['', '.cmd', '.ps1'] : [''];
    const owned: string[] = [];
    for (const name of ['pnpm', 'pnpx']) {
        for (const extension of extensions) {
            const file = join(nodeBin, `${name}${extension}`);
            let stat;
            try {
                stat = lstatSync(file);
            } catch (error) {
                if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                    continue;
                }
                throw error;
            }
            // Corepack disable unlinks names blindly. Admit the whole affected set
            // before invoking it, so an unrelated launcher is never removed.
            if (!stat.isSymbolicLink() || realpathSync(file) !== realpathSync(join(corepackDist, `${name}.js`))) {
                throw new Error(`Refusing to remove an unrecognized Node package-manager launcher: ${file}`);
            }
            owned.push(file);
        }
    }
    if (owned.length === 0) {
        return [];
    }
    const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !/^(npm_|pnpm_|corepack_|node_options$|node_path$)/i.test(name))
    );
    const result = nativeCommand(
        node,
        [join(corepackDist, 'corepack.js'), 'disable', 'pnpm', '--install-directory', nodeBin],
        { cwd: nodeBin, env: { ...env, COREPACK_ENABLE_NETWORK: '0' } }
    );
    if (result.status !== 0) {
        throw new Error("Could not disable the selected Node installation's Corepack shims");
    }
    for (const file of owned) {
        try {
            lstatSync(file);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                continue;
            }
            throw error;
        }
        throw new Error(`Corepack left a package-manager launcher in the selected Node directory: ${file}`);
    }
    return owned;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    if (process.argv[2] === '--prepare-node') {
        if (process.env.GITHUB_ACTIONS !== 'true') {
            throw new Error('Node preparation is restricted to the CI action');
        }
        preparePnpmNode(process.execPath);
        console.log('Selected Node installation cannot shadow the verified pnpm target');
    } else {
        const workspace = process.env.GITHUB_WORKSPACE;
        if (!workspace) {
            throw new Error('pnpm setup requires GITHUB_WORKSPACE');
        }
        const result = setupPnpm({
            workspace,
            manifest: process.env.SOURDAW_PNPM_MANIFEST ?? 'package.json',
            dest: process.env.SOURDAW_PNPM_DEST,
            env: process.env,
            node: process.execPath,
        });
        console.log(`Verified JavaScript pnpm ${result.version}`);
    }
}
