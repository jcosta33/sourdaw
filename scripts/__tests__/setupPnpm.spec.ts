import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import { setupPnpm, type SetupPnpmOptions } from '../setupPnpm';

const directories: string[] = [];
const repository = resolve(import.meta.dirname, '../..');

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'verified-pnpm-'));
    directories.push(root);
    const workspace = join(root, 'project');
    mkdirSync(workspace);
    const dest = join(root, 'tools');
    mkdirSync(dest, { mode: 0o755 });
    chmodSync(dest, 0o755);
    writeFileSync(join(workspace, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.6.0' }));
    writeFileSync(join(workspace, 'pnpm-lock.yaml'), 'unchanged project lock\n');
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
    for (const name of ['GITHUB_PATH', 'GITHUB_ENV', 'GITHUB_OUTPUT']) {
        env[name] = join(workspace, name);
        writeFileSync(env[name], '');
    }
    const target = join(dest, 'runtime/target/node_modules/pnpm/bin/pnpm.mjs');
    const implementation: NonNullable<SetupPnpmOptions['run']> = (_file, args) => {
        if (args.includes('self-update')) {
            mkdirSync(dirname(target), { recursive: true });
            mkdirSync(join(dest, 'runtime/bin'), { recursive: true });
            writeFileSync(target, 'console.log("11.6.0");\n');
            writeFileSync(
                join(dirname(target), '../package.json'),
                JSON.stringify({ name: 'pnpm', version: '11.6.0' })
            );
            writeFileSync(join(dest, 'runtime/bin/pnpm'), `#!/bin/sh\n# cmd-shim-target=${target}\n`);
        }
        return { status: 0, stdout: args.includes('--version') ? '11.6.0\n' : '' };
    };
    const run = vi.fn<NonNullable<SetupPnpmOptions['run']>>(implementation);
    const options: SetupPnpmOptions = {
        workspace,
        dest,
        manifest: 'package.json',
        node: process.execPath,
        env,
        run,
    };
    const exports = () =>
        ['GITHUB_PATH', 'GITHUB_ENV', 'GITHUB_OUTPUT'].map((name) => readFileSync(join(workspace, name), 'utf8'));
    return { workspace, dest, options, run, implementation, target, exports };
}

describe('verified JavaScript pnpm setup', () => {
    it('installs an isolated pinned bootstrap, verifies the target, then exports only the target bin', () => {
        const input = fixture();
        input.options.env.NODE_OPTIONS = '--require=/untrusted/preload.cjs';
        input.options.env.npm_config_cache = '/shared/cache';
        input.options.env.PNPM_HOME = '/shared/pnpm';
        input.options.env.COREPACK_ROOT = '/shared/corepack';
        const project = readFileSync(join(input.workspace, 'package.json'), 'utf8');
        const lock = readFileSync(join(input.workspace, 'pnpm-lock.yaml'), 'utf8');
        const result = setupPnpm(input.options);
        expect(input.run.mock.calls.map(([file, args]) => [file, args])).toEqual([
            [
                process.execPath,
                [
                    process.platform === 'win32'
                        ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
                        : resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
                    'ci',
                    '--ignore-scripts',
                    '--no-audit',
                    '--no-fund',
                ],
            ],
            [
                process.execPath,
                [join(result.dest, 'bootstrap/node_modules/pnpm/bin/pnpm.mjs'), 'self-update', '11.6.0'],
            ],
            [process.execPath, [input.target, '--version']],
        ]);
        for (const [, , options] of input.run.mock.calls) {
            expect(options.cwd).toBe(join(result.dest, 'bootstrap'));
            expect(options.env).toMatchObject({
                NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
                NPM_CONFIG_STRICT_SSL: 'true',
                PNPM_HOME: join(result.dest, 'runtime'),
                PNPM_CONFIG_STORE_DIR: join(result.dest, 'store'),
                XDG_CONFIG_HOME: join(result.dest, 'config'),
            });
            for (const key of ['NODE_OPTIONS', 'npm_config_cache', 'COREPACK_ROOT']) {
                expect(options.env[key]).toBeUndefined();
            }
            expect(readFileSync(options.env.NPM_CONFIG_USERCONFIG!, 'utf8')).toBe('');
            expect(readFileSync(options.env.NPM_CONFIG_GLOBALCONFIG!, 'utf8')).toBe('');
        }
        expect(input.exports()).toEqual([
            `${result.bin}\n`,
            `PNPM_HOME=${join(result.dest, 'runtime')}\n`,
            `dest=${result.dest}\nbin_dest=${result.bin}\n`,
        ]);
        expect(readFileSync(join(input.workspace, 'package.json'), 'utf8')).toBe(project);
        expect(readFileSync(join(input.workspace, 'pnpm-lock.yaml'), 'utf8')).toBe(lock);
    });

    it.each([0, 1, 2])('exports nothing when command %s fails and never executes a later command', (failure) => {
        const input = fixture();
        input.run.mockImplementation((file, args, options) => ({
            ...input.implementation(file, args, options),
            status: input.run.mock.calls.length - 1 === failure ? 1 : 0,
        }));
        expect(() => setupPnpm(input.options)).toThrow('failed');
        expect(input.run).toHaveBeenCalledTimes(failure + 1);
        expect(input.exports()).toEqual(['', '', '']);
    });

    it('does not activate a bootstrap version returned instead of the target', () => {
        const input = fixture();
        input.run.mockImplementation((file, args, options) => ({
            ...input.implementation(file, args, options),
            stdout: args.includes('--version') ? '11.26.0\n' : '',
        }));
        expect(() => setupPnpm(input.options)).toThrow('reports 11.26.0, expected 11.6.0');
        expect(input.exports()).toEqual(['', '', '']);
    });

    it.each(['pnpm@12.0.0', 'pnpm@^11.6.0', '@pnpm/exe@11.6.0', 'pnpm@11.6.0+sha512.fake', 'npm@11.6.0'])(
        'refuses unsupported or non-exact declaration %s before invoking a command',
        (packageManager) => {
            const input = fixture();
            writeFileSync(join(input.workspace, 'package.json'), JSON.stringify({ packageManager }));
            expect(() => setupPnpm(input.options)).toThrow('exact JavaScript pnpm 11');
            expect(input.run).not.toHaveBeenCalled();
            expect(input.exports()).toEqual(['', '', '']);
        }
    );

    it('refuses a second package-manager selector and a manifest outside the workspace', () => {
        const input = fixture();
        writeFileSync(
            join(input.workspace, 'package.json'),
            JSON.stringify({ packageManager: 'pnpm@11.6.0', devEngines: { packageManager: { name: 'pnpm' } } })
        );
        expect(() => setupPnpm(input.options)).toThrow('one packageManager');
        expect(() => setupPnpm({ ...input.options, manifest: '../package.json' })).toThrow('belong to the workspace');
        expect(input.run).not.toHaveBeenCalled();
    });

    it('refuses a destination within the project before installing or editing project files', () => {
        const input = fixture();
        input.options.dest = join(input.workspace, 'tools');
        expect(() => setupPnpm(input.options)).toThrow('outside the project workspace');
        expect(input.run).not.toHaveBeenCalled();
    });

    it('refuses manifest and destination ancestor symlinks that cross the project boundary', () => {
        const input = fixture();
        const outside = join(dirname(input.workspace), 'outside.json');
        writeFileSync(outside, JSON.stringify({ packageManager: 'pnpm@11.6.0' }));
        symlinkSync(outside, join(input.workspace, 'manifest-link.json'));
        expect(() => setupPnpm({ ...input.options, manifest: 'manifest-link.json' })).toThrow(
            'belong to the workspace'
        );
        const ancestor = join(dirname(input.workspace), 'ancestor');
        symlinkSync(input.workspace, ancestor);
        expect(() => setupPnpm({ ...input.options, dest: join(ancestor, 'tools') })).toThrow(
            'outside the project workspace'
        );
        expect(input.run).not.toHaveBeenCalled();
    });

    it('uses JavaScript entrypoints and known Node on Windows without shell launchers', () => {
        const input = fixture();
        input.options.platform = 'win32';
        input.options.node = join(dirname(input.workspace), 'Node tools & 100%', 'node.exe');
        setupPnpm(input.options);
        expect(input.run.mock.calls.map(([file]) => file)).toEqual([
            input.options.node,
            input.options.node,
            input.options.node,
        ]);
        expect(input.run.mock.calls[0]?.[1][0]).toBe(
            join(dirname(input.options.node), 'node_modules/npm/bin/npm-cli.js')
        );
        expect(input.run.mock.calls[2]?.[1]).toEqual([input.target, '--version']);
        expect(input.run.mock.calls.some(([file]) => /\.cmd$|cmd\.exe$/.test(file))).toBe(false);
    });

    it('executes the Windows-layout JavaScript route with literal shell metacharacters in tool paths', () => {
        const input = fixture();
        const nodeDirectory = join(dirname(input.workspace), 'Node tools & 100%');
        mkdirSync(join(nodeDirectory, 'node_modules/npm/bin'), { recursive: true });
        const node = join(nodeDirectory, 'node.exe');
        symlinkSync(process.execPath, node);
        const bootstrap = `import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const home=process.env.PNPM_HOME;
const entry=join(home,'target/node_modules/pnpm/bin/pnpm.mjs');
mkdirSync(join(home,'bin'),{recursive:true});
mkdirSync(join(home,'target/node_modules/pnpm/bin'),{recursive:true});
writeFileSync(entry,'console.log("11.6.0");');
writeFileSync(join(home,'target/node_modules/pnpm/package.json'),JSON.stringify({name:'pnpm',version:'11.6.0'}));
writeFileSync(join(home,'bin/pnpm'),'# cmd-shim-target='+entry+'\\n');`;
        const npm = `const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['ci','--ignore-scripts','--no-audit','--no-fund']))process.exit(9);
mkdirSync(join(process.cwd(),'node_modules/pnpm/bin'),{recursive:true});
writeFileSync(join(process.cwd(),'node_modules/pnpm/bin/pnpm.mjs'),${JSON.stringify(bootstrap)});`;
        writeFileSync(join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js'), npm);
        const result = setupPnpm({ ...input.options, node, platform: 'win32', run: undefined });
        expect(result.version).toBe('11.6.0');
        expect(input.exports()[0]).toBe(`${result.bin}\n`);
    });

    it('rejects a target shim redirected outside its verified installation', () => {
        const input = fixture();
        input.run.mockImplementation((file, args, options) => {
            const result = input.implementation(file, args, options);
            if (args.includes('self-update')) {
                writeFileSync(
                    join(input.dest, 'runtime/bin/pnpm'),
                    `# cmd-shim-target=${join(input.workspace, 'pnpm.mjs')}\n`
                );
                writeFileSync(join(input.workspace, 'pnpm.mjs'), 'throw new Error("foreign target executed");');
            }
            return result;
        });
        expect(() => setupPnpm(input.options)).toThrow('independent installation');
        expect(input.run).toHaveBeenCalledTimes(2);
        expect(input.exports()).toEqual(['', '', '']);
    });

    it.each([
        ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
        ['npm_config_strict_ssl', 'false'],
        ['npm_config_registry', 'https://mirror.example/'],
        ['PNPM_CONFIG_PACKAGE_MANAGER_REGISTRIES', '{}'],
        ['PNPM_CONFIG_PACKAGE_MANAGER_NETWORK_CONFIG', '{}'],
        ['PNPM_CONFIG_PM_ON_FAIL', 'ignore'],
        ['COREPACK_INTEGRITY_KEYS', '0'],
    ])('refuses security-changing %s before acquisition', (name, value) => {
        const input = fixture();
        input.options.env[name] = value;
        expect(() => setupPnpm(input.options)).toThrow(`security-changing environment variable ${name}`);
        expect(input.run).not.toHaveBeenCalled();
        expect(input.exports()).toEqual(['', '', '']);
    });

    it.each(['populated', 'symlink', 'writable'])('refuses a %s destination without changing its contents', (kind) => {
        const input = fixture();
        if (kind === 'populated') writeFileSync(join(input.dest, 'foreign'), 'preserve');
        if (kind === 'writable') chmodSync(input.dest, 0o777);
        if (kind === 'symlink') {
            const link = join(dirname(input.dest), 'link');
            symlinkSync(input.dest, link);
            input.options.dest = link;
        }
        expect(() => setupPnpm(input.options)).toThrow('empty owned directory');
        expect(input.run).not.toHaveBeenCalled();
        if (kind === 'populated') expect(readFileSync(join(input.dest, 'foreign'), 'utf8')).toBe('preserve');
    });

    it('keeps the authenticated official bootstrap byte pin and composite runtime immutable', () => {
        const directory = join(repository, '.github/actions/setup-pnpm');
        const manifest: unknown = JSON.parse(readFileSync(join(directory, 'bootstrap/package.json'), 'utf8'));
        expect(manifest).toEqual({ name: 'sourdaw-pnpm-bootstrap', private: true, dependencies: { pnpm: '11.26.0' } });
        const lock: unknown = JSON.parse(readFileSync(join(directory, 'bootstrap/package-lock.json'), 'utf8'));
        expect(lock).toMatchObject({
            packages: {
                'node_modules/pnpm': {
                    version: '11.26.0',
                    resolved: 'https://registry.npmjs.org/pnpm/-/pnpm-11.26.0.tgz',
                    integrity:
                        'sha512-/A4r+JC5+YNhHxq2jAY3vOkUOQZTaZ+DwaeLAF7SXyyB53kgyP2O7i7PC1iyjNywCoTZf2m898VrLzRHECOGZA==',
                },
            },
        });
        const action: unknown = parseDocument(readFileSync(join(directory, 'action.yml'), 'utf8')).toJS();
        expect(action).toMatchObject({
            runs: {
                using: 'composite',
                steps: [
                    {
                        uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
                        with: { 'node-version': '24.19.0', 'package-manager-cache': false },
                    },
                    { run: 'node "$GITHUB_ACTION_PATH/../../../scripts/setupPnpm.ts"' },
                ],
            },
        });
    });
});
