import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type GitResult = { status: number | null; stdout: string; stderr: string };
export type CopyPorts = {
    run: (args: string[]) => GitResult;
    independentObjects: (path: string) => void;
};

function independentObjects(path: string): void {
    let entries = 0;
    const deadline = Date.now() + 300_000;
    function visit(current: string): void {
        const stat = lstatSync(current);
        if (++entries > 100_000 || Date.now() > deadline || stat.isSymbolicLink()) {
            throw new Error('unit execution object independence unavailable');
        }
        if (stat.isDirectory()) {
            for (const name of readdirSync(current)) {
                visit(join(current, name));
            }
        } else if (!stat.isFile() || stat.nlink !== 1 || current.endsWith('/info/alternates')) {
            throw new Error('unit execution objects must be independent');
        }
    }
    visit(path);
}

export function copyUnitCheckout(source: string, destination: string, ports: CopyPorts): string {
    function git(args: string[]): string {
        const result = ports.run(args);
        if (result.status !== 0 || result.stderr !== '') {
            throw new Error('unit execution Git copy failed');
        }
        return result.stdout.trim();
    }
    const head = git(['-C', source, 'rev-parse', '--verify', 'HEAD']);
    if (
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head) ||
        git(['-C', source, 'rev-parse', '--is-shallow-repository']) !== 'false'
    ) {
        throw new Error('unit execution requires exact HEAD and complete source history');
    }
    const refs = git(['-C', source, 'show-ref']).split('\n').sort().join('\n');
    git(['clone', '--quiet', '--mirror', '--no-local', '--no-hardlinks', '--', source, join(destination, '.git')]);
    git(['-C', destination, 'config', 'core.bare', 'false']);
    git(['-C', destination, 'checkout', '--quiet', '--detach', head]);
    if (
        git(['-C', destination, 'rev-parse', '--verify', 'HEAD']) !== head ||
        git(['-C', destination, 'rev-parse', '--is-shallow-repository']) !== 'false' ||
        git(['-C', destination, 'show-ref']).split('\n').sort().join('\n') !== refs
    ) {
        throw new Error('unit execution copy lost HEAD, history or refs');
    }
    ports.independentObjects(join(destination, '.git/objects'));
    return head;
}

export const assertIndependentUnitObjects = independentObjects;

// This stdlib-only program must run before importing any file behind runner ancestry.
export const unitAccessBootstrap = `
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const context = JSON.parse(process.argv[1]);
let role = 'identity';
try {
  const fields = new Map();
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  if (!status.endsWith('\\n') || status.length > 16384) throw new Error('identity-incomplete');
  for (const line of status.split('\\n')) {
    const match = /^(Uid|Gid|Groups|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs):\\s*(.*)$/.exec(line);
    if (!match) continue;
    if (fields.has(match[1])) throw new Error('identity-duplicate');
    fields.set(match[1], match[2].trim());
  }
  for (const [key, id] of [['Uid', context.uid], ['Gid', context.gid]]) {
    const values = (fields.get(key) || '').split(/\\s+/);
    if (values.length !== 4 || values.some(value => !/^\\d+$/.test(value) || Number(value) !== id)) throw new Error('identity-mismatch');
  }
  if (fields.get('Groups') !== '' || fields.get('NoNewPrivs') !== '1') throw new Error('privilege-mismatch');
  for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
    if (!/^0+$/.test(fields.get(key) || '')) throw new Error('capability-mismatch');
  }
  role = 'checkout';
  const helper = path.join(context.workspace, 'scripts/runIsolatedUnitShard.ts');
  fs.accessSync(helper, fs.constants.R_OK);
  for (let current = path.dirname(helper); ; current = path.dirname(current)) {
    fs.accessSync(current, fs.constants.X_OK);
    if (current === '/') break;
  }
  role = 'node';
  fs.accessSync(context.node, fs.constants.R_OK | fs.constants.X_OK);
  role = 'pnpm-closure';
  let count = 0;
  const deadline = Date.now() + 300000;
  function visit(current) {
    const physical = fs.realpathSync(current);
    const relative = path.relative(context.toolRoot, physical);
    if (relative.startsWith('..') || path.isAbsolute(relative) || ++count > 100000 || Date.now() > deadline) throw new Error('closure-boundary');
    const stat = fs.statSync(physical);
    fs.accessSync(physical, fs.constants.R_OK | (stat.isDirectory() || (stat.mode & 0o111) ? fs.constants.X_OK : 0));
    if (stat.isDirectory()) for (const name of fs.readdirSync(physical)) visit(path.join(physical, name));
    else if (!stat.isFile()) throw new Error('closure-type');
  }
  visit(context.toolRoot);
  fs.accessSync(context.pnpm, fs.constants.R_OK | fs.constants.X_OK);
  console.info('unit isolation access admitted: uid=' + context.uid + ' gid=' + context.gid + ' groups=empty caps=empty no-new-privs=1 checkout=readable pnpm-closure=readable');
} catch (error) {
  const code = error && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'INVALID';
  console.error('unit isolation access failed: role=' + role + ' code=' + code);
  process.exit(1);
}
import(pathToFileURL(path.join(context.workspace, 'scripts/runIsolatedUnitShard.ts')).href)
  .then(module => { process.exitCode = module.runUnitPhase(context, process.argv[2], process.argv[3]); })
  .catch(() => { console.error('unit isolation copied helper failed'); process.exitCode = 1; });
`;
