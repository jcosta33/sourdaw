import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    cpSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { installedGraph, physicalChild } from '../../../dependencyPorts/jsToolingInstalled.mjs';
const graph = installedGraph(process.cwd()),
    parent = graph.packageRoot('dependency-cruiser'),
    commander = physicalChild(parent, 'commander');
assert.equal(JSON.parse(readFileSync(join(commander, 'package.json'))).version, '15.1.0');
const root = mkdtempSync(join(tmpdir(), 'sourdaw-commander-'));
try {
    const prefix = join(root, 'npm-prefix'),
        copy = join(prefix, 'lib/node_modules/dependency-cruiser'),
        cwd = join(root, 'project');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'package.json'), '{"name":"fixture","private":true,"type":"module"}');
    writeFileSync(join(cwd, 'entry.js'), 'export const value=42;');
    cpSync(parent, copy, {
        recursive: true,
        filter: (source) => source === parent || !source.startsWith(join(parent, 'node_modules')),
    });
    const dependencyNames = JSON.parse(readFileSync(join(parent, 'package.json'))).dependencies;
    mkdirSync(join(copy, 'node_modules'));
    for (const name of Object.keys(dependencyNames)) {
        const actual = physicalChild(parent, name);
        if (!actual) continue;
        mkdirSync(dirname(join(copy, 'node_modules', name)), { recursive: true });
        if (name === 'is-installed-globally') {
            cpSync(actual, join(copy, 'node_modules', name), { recursive: true });
            symlinkSync(dirname(actual), join(copy, 'node_modules', name, 'node_modules'), 'junction');
        } else symlinkSync(actual, join(copy, 'node_modules', name), 'junction');
    }
    const entry = join(copy, 'bin/dependency-cruiser.mjs'),
        env = {
            PATH: process.env.PATH,
            HOME: root,
            USERPROFILE: root,
            npm_config_prefix: prefix,
            FAKEROOTKEY: '1',
            NO_COLOR: '1',
        };
    function run(args, global = true) {
        const p = spawnSync(process.execPath, [entry, ...args], {
            cwd,
            env: { ...env, npm_config_prefix: global ? prefix : cwd },
            encoding: 'utf8',
            timeout: 20000,
        });
        assert.ifError(p.error);
        return p;
    }
    for (const args of [['--help'], ['--version'], ['--no-config', '--output-type', 'json', 'entry.js']]) {
        const p = run(args);
        assert.equal(p.status, 0, p.stdout + p.stderr);
        if (args[0] === '--help') assert.match(p.stdout, /Validate and visualize/);
        if (args[0] === '--version') assert.match(p.stdout, /18\.7\.2/);
        if (args[0] === '--no-config') {
            const g = JSON.parse(p.stdout);
            assert(g.modules.some((m) => m.source === 'entry.js'));
        }
    }
    const invalid = run(['--definitely-invalid-option']);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /unknown option/);
    const generated = run(['--init', 'yes']);
    assert.equal(generated.status, 0, generated.stdout + generated.stderr);
    const filename = readdirSync(cwd).find((n) => n.startsWith('.dependency-cruiser.'));
    assert(filename, generated.stdout);
    const configuration = createRequire(import.meta.url)(join(cwd, filename));
    assert(configuration.forbidden.some((r) => r.name === 'no-circular'));
    assert(configuration.options);
    const global = run(['--info']);
    assert.equal(global.status, 0, global.stderr);
    assert.match(global.stderr, /globally installed dependency-cruiser/);
    const local = run(['--info'], false);
    assert.equal(local.status, 0, local.stderr);
    assert.doesNotMatch(local.stderr, /globally installed dependency-cruiser/);
    console.log('actual Commander CLI help/options/JSON/config/global-warning passed');
} finally {
    rmSync(root, { recursive: true, force: true });
}
