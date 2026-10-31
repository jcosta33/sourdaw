import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import { preparePnpmNode, setupPnpm, type SetupPnpmOptions } from '../setupPnpm';

const directories: string[] = [];
const repository = resolve(import.meta.dirname, '../..');

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
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
    const implementation: NonNullable<SetupPnpmOptions['run']> = (_file, args, { env }) => {
        if (args.includes('self-update')) {
            const home = env.PNPM_HOME;
            if (!home) {
                throw new Error('Fixture requires an isolated pnpm home');
            }
            const installedTarget = join(home, 'target/node_modules/pnpm/bin/pnpm.mjs');
            mkdirSync(dirname(installedTarget), { recursive: true });
            mkdirSync(join(home, 'bin'), { recursive: true });
            writeFileSync(installedTarget, 'console.log("11.6.0");\n');
            writeFileSync(
                join(dirname(installedTarget), '../package.json'),
                JSON.stringify({ name: 'pnpm', version: '11.6.0' })
            );
            writeFileSync(join(home, 'bin/pnpm'), `#!/bin/sh\n# cmd-shim-target=${installedTarget}\n`);
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

function configFileProcess(
    input: ReturnType<typeof fixture>,
    options: { injection?: { name: string; kind: 'file' | 'symlink' }; mask?: number; dest?: string } = {}
) {
    const script = join(dirname(input.workspace), 'config-files.mjs');
    writeFileSync(
        script,
        `import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {basename,dirname,join,relative,isAbsolute,sep} from 'node:path';
if(process.platform!=='win32')process.umask(${options.mask ?? 0o022});
const workspace=${JSON.stringify(input.workspace)},dest=${JSON.stringify(options.dest ?? input.dest)},env=${JSON.stringify(input.options.env)};
const injection=${JSON.stringify(options.injection ?? null)};
const target=join(workspace,'preserve-config-target');
fs.writeFileSync(target,'preserve input');
let config,configMode=null,files={},injected=false;
const write=fs.writeFileSync;
fs.writeFileSync=(file,data,options)=>{
 if(typeof file!=='string'||!['user.npmrc','global.npmrc'].includes(basename(file)))return write(file,data,options);
 config=dirname(file);
 if(injection&&basename(file)===injection.name&&!injected){
  injected=true;
  if(injection.kind==='symlink')fs.symlinkSync(target,file);
  else write(file,'preserve input');
 }
 try{return write(file,data,options);}
 finally{
  configMode=fs.statSync(config).mode&0o777;
  for(const name of ['user.npmrc','global.npmrc']){
   const requested=join(config,name);
   if(fs.existsSync(requested))files[name]={mode:fs.statSync(requested).mode&0o777,content:fs.readFileSync(requested,'utf8'),symlink:fs.lstatSync(requested).isSymbolicLink()};
  }
 }
};
syncBuiltinESMExports();
const {setupPnpm}=await import(${JSON.stringify(pathToFileURL(join(repository, 'scripts/setupPnpm.ts')).href)});
let commands=0,error;
try{setupPnpm({workspace,dest,manifest:'package.json',env,node:process.execPath,run:()=>{commands++;return {status:1,stdout:''};}});}
catch(caught){error={code:caught.code??null,message:caught.message};}
const mode=file=>fs.existsSync(file)?fs.statSync(file).mode&0o777:null;
const within=(root,file)=>{const child=relative(root,file);return child!=='..'&&!child.startsWith('..'+sep)&&!isAbsolute(child);};
console.log(JSON.stringify({creationMask:process.umask(),destinationExists:fs.existsSync(dest),rootMode:mode(dest),configMode,runtimeMode:mode(join(dest,'runtime')),bootstrapMode:mode(join(dest,'bootstrap')),privateSibling:config?dirname(config)===dirname(dest)&&!within(dest,config)&&!within(workspace,config):null,configRemoved:config?!fs.existsSync(config):null,files,commands,error,target:fs.readFileSync(target,'utf8'),exports:['GITHUB_PATH','GITHUB_ENV','GITHUB_OUTPUT'].map(name=>fs.readFileSync(env[name],'utf8'))}));
`
    );
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 5_000 });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    const report: unknown = JSON.parse(result.stdout);
    return report;
}

function expectConfigCollision(injection: { name: string; kind: 'file' | 'symlink' }) {
    const report = configFileProcess(fixture(), { injection });
    expect(report).toMatchObject({
        files: { [injection.name]: { content: 'preserve input', symlink: injection.kind === 'symlink' } },
        commands: 0,
        error: { code: 'EEXIST' },
        privateSibling: true,
        configRemoved: true,
        target: 'preserve input',
        exports: ['', '', ''],
    });
    if (process.platform !== 'win32') {
        expect(report).toMatchObject({ rootMode: 0o755, configMode: 0o700 });
    }
}

describe('verified JavaScript pnpm setup', () => {
    it.skipIf(process.platform === 'win32')(
        'creates private config files and readable executable directories under the ordinary creation mask',
        () => {
            const report = configFileProcess(fixture());
            expect(report).toMatchObject({
                creationMask: 0o022,
                privateSibling: true,
                configRemoved: true,
                rootMode: 0o755,
                configMode: 0o700,
                runtimeMode: 0o755,
                bootstrapMode: 0o755,
                files: {
                    'user.npmrc': { mode: 0o600, content: '', symlink: false },
                    'global.npmrc': { mode: 0o600, content: '', symlink: false },
                },
                commands: 1,
                target: 'preserve input',
                exports: ['', '', ''],
            });
        }
    );

    it.skipIf(process.platform === 'win32').each([
        { mask: 0o000, permissions: 'group and other' },
        { mask: 0o002, permissions: 'group' },
        { mask: 0o020, permissions: 'other' },
    ])('refuses a mask permitting $permissions writes before creating the destination', ({ mask }) => {
        const input = fixture();
        const dest = join(dirname(input.workspace), 'uncreated-tools');
        const report = configFileProcess(input, { mask, dest });
        expect(report).toMatchObject({
            creationMask: mask,
            destinationExists: false,
            rootMode: null,
            configMode: null,
            runtimeMode: null,
            bootstrapMode: null,
            files: {},
            commands: 0,
            error: {
                message: 'pnpm setup requires creation mask 022 for shared executable access and write protection',
            },
            target: 'preserve input',
            exports: ['', '', ''],
        });
    });

    it.skipIf(process.platform === 'win32').each([0o077, 0o026, 0o023])(
        'refuses restrictive mask %i with an existing readable tool root before writing descendants',
        (mask) => {
            const input = fixture();
            const report = configFileProcess(input, { mask });
            expect(report).toMatchObject({
                creationMask: mask,
                destinationExists: true,
                rootMode: 0o755,
                configMode: null,
                runtimeMode: null,
                bootstrapMode: null,
                files: {},
                commands: 0,
                error: {
                    message: 'pnpm setup requires creation mask 022 for shared executable access and write protection',
                },
                target: 'preserve input',
                exports: ['', '', ''],
            });
            expect(readdirSync(input.dest)).toEqual([]);
        }
    );

    it.each(['user.npmrc', 'global.npmrc'])(
        'refuses an existing %s file before running any package command',
        (name) => {
            expectConfigCollision({ name, kind: 'file' });
        }
    );

    it.skipIf(process.platform === 'win32').each(['user.npmrc', 'global.npmrc'])(
        'refuses an existing %s symlink before running any package command',
        (name) => {
            expectConfigCollision({ name, kind: 'symlink' });
        }
    );

    it('keeps the default job directory stable for cache paths and refuses reuse of populated storage', () => {
        const input = fixture();
        input.options.dest = undefined;
        input.options.env.RUNNER_TEMP = dirname(input.workspace);
        const result = setupPnpm(input.options);
        expect(result.dest).toBe(join(dirname(input.workspace), 'sourdaw-pnpm'));
        const exported = input.exports();
        expect(() => setupPnpm(input.options)).toThrow('empty owned directory');
        expect(input.run).toHaveBeenCalledTimes(3);
        expect(input.exports()).toEqual(exported);
    });

    it('installs an isolated pinned bootstrap, verifies the target, then exports only the target bin', () => {
        const input = fixture();
        input.options.env.NODE_OPTIONS = '--require=/untrusted/preload.cjs';
        input.options.env.npm_config_cache = '/shared/cache';
        input.options.env.PNPM_HOME = '/shared/pnpm';
        input.options.env.COREPACK_ROOT = '/shared/corepack';
        const project = readFileSync(join(input.workspace, 'package.json'), 'utf8');
        const lock = readFileSync(join(input.workspace, 'pnpm-lock.yaml'), 'utf8');
        let npmEntrypoint: string;
        if (process.platform === 'win32') {
            npmEntrypoint = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
        } else {
            npmEntrypoint = resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
        }
        let privateConfig: string | undefined;
        input.run.mockImplementation((file, args, options) => {
            privateConfig = options.env.XDG_CONFIG_HOME;
            expect(privateConfig).toBeDefined();
            expect(dirname(privateConfig!)).toBe(dirname(input.dest));
            expect(privateConfig).not.toBe(input.dest);
            expect(readFileSync(options.env.NPM_CONFIG_USERCONFIG!, 'utf8')).toBe('');
            expect(readFileSync(options.env.NPM_CONFIG_GLOBALCONFIG!, 'utf8')).toBe('');
            return input.implementation(file, args, options);
        });
        const result = setupPnpm(input.options);
        expect(existsSync(privateConfig!)).toBe(false);
        expect(input.run.mock.calls.map(([file, args]) => [file, args])).toEqual([
            [process.execPath, [npmEntrypoint, 'ci', '--ignore-scripts', '--no-audit', '--no-fund']],
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
            });
            for (const key of ['NODE_OPTIONS', 'npm_config_cache', 'COREPACK_ROOT']) {
                expect(options.env[key]).toBeUndefined();
            }
            expect(options.env.XDG_CONFIG_HOME).toBe(privateConfig);
        }
        expect(input.exports()).toEqual([
            `${result.bin}\n`,
            `PNPM_HOME=${join(result.dest, 'runtime')}\n`,
            `dest=${result.dest}\nbin_dest=${result.bin}\n`,
        ]);
        expect(readFileSync(join(input.workspace, 'package.json'), 'utf8')).toBe(project);
        expect(readFileSync(join(input.workspace, 'pnpm-lock.yaml'), 'utf8')).toBe(lock);
    });

    it.skipIf(process.platform === 'win32')(
        'keeps every installed tool entry readable outside its private setup config',
        () => {
            const input = fixture();
            const result = setupPnpm(input.options);
            const unreadable: string[] = [];
            const visit = (file: string): void => {
                const stat = statSync(file);
                let required = 0o004;
                if (stat.isDirectory() || (stat.mode & 0o111) !== 0) {
                    required = 0o005;
                }
                if ((stat.mode & required) !== required) {
                    unreadable.push(file);
                }
                if (stat.isDirectory()) {
                    for (const name of readdirSync(file)) {
                        visit(join(file, name));
                    }
                }
            };
            visit(result.dest);
            expect(unreadable).toEqual([]);
            expect(existsSync(join(result.dest, 'config'))).toBe(false);
            expect(input.exports()[0]).toBe(`${result.bin}\n`);
        }
    );

    it.each([0, 1, 2])('exports nothing when command %s fails and never executes a later command', (failure) => {
        const input = fixture();
        input.run.mockImplementation((file, args, options) => ({
            ...input.implementation(file, args, options),
            status: input.run.mock.calls.length - 1 === failure ? 1 : 0,
        }));
        expect(() => setupPnpm(input.options)).toThrow('failed');
        expect(input.run).toHaveBeenCalledTimes(failure + 1);
        const firstCall = input.run.mock.calls[0];
        if (firstCall === undefined) {
            throw new Error('Expected setup to invoke the failing package command');
        }
        const privateConfig = firstCall[2].env.XDG_CONFIG_HOME;
        expect(privateConfig).toBeDefined();
        expect(existsSync(privateConfig!)).toBe(false);
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

    it('selects the physical source manifest beside a control checkout with a different pnpm version', () => {
        const input = fixture();
        const control = join(input.workspace, 'control');
        const source = join(input.workspace, 'source');
        mkdirSync(control);
        mkdirSync(source);
        writeFileSync(join(control, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.7.1' }));
        writeFileSync(join(source, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.6.0' }));

        const result = setupPnpm({ ...input.options, manifest: 'source/package.json' });

        expect(result.version).toBe('11.6.0');
        expect(input.run).toHaveBeenCalledTimes(3);
        expect(input.run.mock.calls[1]?.[1]).toEqual([
            join(input.dest, 'bootstrap/node_modules/pnpm/bin/pnpm.mjs'),
            'self-update',
            '11.6.0',
        ]);
        expect(input.exports()[0]).toBe(`${result.bin}\n`);
    });

    it.each(['leaf', 'ancestor'])(
        'refuses a source manifest %s symlink into the control checkout before acquisition',
        (redirect) => {
            const input = fixture();
            const control = join(input.workspace, 'control');
            const source = join(input.workspace, 'source');
            mkdirSync(control);
            writeFileSync(join(control, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.7.1' }));
            if (redirect === 'leaf') {
                mkdirSync(source);
                symlinkSync('../control/package.json', join(source, 'package.json'));
            } else {
                symlinkSync('control', source, 'dir');
            }

            expect(() => setupPnpm({ ...input.options, manifest: 'source/package.json' })).toThrow(
                'pnpm manifest must use its declared physical path'
            );
            expect(input.run).not.toHaveBeenCalled();
            expect(readdirSync(input.dest)).toEqual([]);
            expect(input.exports()).toEqual(['', '', '']);
        }
    );

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
        if (kind === 'populated') {
            writeFileSync(join(input.dest, 'foreign'), 'preserve');
        }
        if (kind === 'writable') {
            chmodSync(input.dest, 0o777);
        }
        if (kind === 'symlink') {
            const link = join(dirname(input.dest), 'link');
            symlinkSync(input.dest, link);
            input.options.dest = link;
        }
        expect(() => setupPnpm(input.options)).toThrow('empty owned directory');
        expect(input.run).not.toHaveBeenCalled();
        if (kind === 'populated') {
            expect(readFileSync(join(input.dest, 'foreign'), 'utf8')).toBe('preserve');
        }
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
                    { run: 'node "$GITHUB_ACTION_PATH/../../../scripts/setupPnpm.ts" --prepare-node' },
                    { run: 'node "$GITHUB_ACTION_PATH/../../../scripts/setupPnpm.ts"' },
                ],
            },
        });
    });
});

function nodeFixture() {
    const root = mkdtempSync(join(tmpdir(), 'pnpm-node-preparation-'));
    directories.push(root);
    const bin = join(root, 'node-bin');
    mkdirSync(bin);
    const node = join(bin, process.platform === 'win32' ? 'node.exe' : 'node');
    symlinkSync(process.execPath, node);
    let corepack: string;
    let official: string;
    if (process.platform === 'win32') {
        corepack = join(bin, 'node_modules/corepack');
        official = join(dirname(process.execPath), 'node_modules/corepack');
    } else {
        corepack = resolve(bin, '../lib/node_modules/corepack');
        official = resolve(dirname(process.execPath), '../lib/node_modules/corepack');
    }
    mkdirSync(dirname(corepack), { recursive: true });
    symlinkSync(official, corepack, 'dir');
    for (const name of ['npm', 'npx', 'yarn', 'unrelated']) {
        writeFileSync(join(bin, name), `preserve ${name}`);
    }
    const link = (name: string) => symlinkSync(join(corepack, 'dist', `${name}.js`), join(bin, name));
    return { root, bin, node, link };
}

describe('selected Node package-manager precedence', () => {
    it('restricts CLI preparation to CI and uses only the selected temporary Node', () => {
        const input = nodeFixture();
        input.link('pnpm');
        input.link('pnpx');
        const preload = join(input.root, 'selected-node.mjs');
        writeFileSync(preload, `Object.defineProperty(process,'execPath',{value:${JSON.stringify(input.node)}});\n`);
        const invoke = (ci: string) =>
            spawnSync(
                process.execPath,
                ['--import', preload, join(repository, 'scripts/setupPnpm.ts'), '--prepare-node'],
                { env: { ...process.env, GITHUB_ACTIONS: ci }, encoding: 'utf8' }
            );
        const outside = invoke('false');
        expect(outside.status).not.toBe(0);
        expect(outside.stderr).toContain('restricted to the CI action');
        expect(existsSync(join(input.bin, 'pnpm'))).toBe(true);
        const inside = invoke('true');
        expect(inside.status, inside.stderr).toBe(0);
        expect(existsSync(join(input.bin, 'pnpm'))).toBe(false);
        expect(existsSync(join(input.bin, 'pnpx'))).toBe(false);
        expect(readFileSync(join(input.bin, 'npm'), 'utf8')).toBe('preserve npm');
    });

    it('does nothing when the selected Node has no package-manager aliases', () => {
        const input = nodeFixture();
        expect(preparePnpmNode(input.node)).toEqual([]);
        expect(readFileSync(join(input.bin, 'npm'), 'utf8')).toBe('preserve npm');
    });

    it('removes only known Corepack shims so outer Node PATH prepend still queries the verified target cache', () => {
        const input = nodeFixture();
        input.link('pnpm');
        input.link('pnpx');
        const target = join(input.root, 'verified-bin');
        mkdirSync(target);
        writeFileSync(join(target, 'pnpm'), '#!/bin/sh\nprintf "verified-target-store\\n"\n');
        chmodSync(join(target, 'pnpm'), 0o755);
        writeFileSync(join(input.root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.6.0' }));
        const query = () =>
            spawnSync('bash', ['-c', 'pnpm store path --silent'], {
                cwd: input.root,
                env: {
                    ...process.env,
                    PATH: [input.bin, target, process.env.PATH].join(delimiter),
                    COREPACK_HOME: join(input.root, 'empty-corepack-home'),
                    COREPACK_ENABLE_NETWORK: '0',
                },
                encoding: 'utf8',
            });
        const before = query();
        expect(before.status).not.toBe(0);
        expect(before.stderr).toContain('Network access disabled');
        expect(preparePnpmNode(input.node)).toEqual([join(input.bin, 'pnpm'), join(input.bin, 'pnpx')]);
        expect(existsSync(join(input.bin, 'pnpm'))).toBe(false);
        expect(existsSync(join(input.bin, 'pnpx'))).toBe(false);
        const after = query();
        expect(after.status).toBe(0);
        expect(after.stdout.trim()).toBe('verified-target-store');
        for (const name of ['npm', 'npx', 'yarn', 'unrelated']) {
            expect(readFileSync(join(input.bin, name), 'utf8')).toBe(`preserve ${name}`);
        }
    });

    it('refuses a foreign launcher before deleting any recognized peer', () => {
        const input = nodeFixture();
        input.link('pnpm');
        writeFileSync(join(input.bin, 'pnpx'), 'foreign launcher');
        expect(() => preparePnpmNode(input.node)).toThrow('unrecognized Node package-manager launcher');
        expect(existsSync(join(input.bin, 'pnpm'))).toBe(true);
        expect(readFileSync(join(input.bin, 'pnpx'), 'utf8')).toBe('foreign launcher');
    });

    it('refuses a foreign symlink without removing either the link or its target', () => {
        const input = nodeFixture();
        const foreign = join(input.root, 'foreign.js');
        writeFileSync(foreign, 'preserve foreign target');
        symlinkSync(foreign, join(input.bin, 'pnpm'));
        input.link('pnpx');
        expect(() => preparePnpmNode(input.node)).toThrow('unrecognized Node package-manager launcher');
        expect(existsSync(join(input.bin, 'pnpm'))).toBe(true);
        expect(existsSync(join(input.bin, 'pnpx'))).toBe(true);
        expect(readFileSync(foreign, 'utf8')).toBe('preserve foreign target');
    });
});
