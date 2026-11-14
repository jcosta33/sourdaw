import { spawnSync } from 'node:child_process';
import {
    chmodSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { parseHealthGateWorkflows } from '../healthGateWorkflowContract';

const root = process.cwd();
let fixture = '';

afterEach(() => {
    if (fixture) {
        rmSync(fixture, { recursive: true, force: true });
    }
});

it('runs the actual health script without root dependencies and propagates failures', () => {
    fixture = mkdtempSync(join(tmpdir(), 'sourdaw-health-launcher-'));
    mkdirSync(join(fixture, 'scripts'));
    mkdirSync(join(fixture, 'server'));
    const bin = join(fixture, 'witness-bin');
    mkdirSync(bin);
    for (const file of [
        'package.json',
        'pnpm-workspace.yaml',
        'pnpm-lock.yaml',
        'scripts/health-gates-rust.sh',
        'scripts/health-gates-server.sh',
    ]) {
        copyFileSync(join(root, file), join(fixture, file));
    }
    expect(existsSync(join(fixture, 'node_modules'))).toBe(false);
    const commandLog = join(fixture, 'commands.log');
    const witness = (name: string, script: string): void => {
        const file = join(bin, name);
        writeFileSync(file, `#!/bin/sh\nprintf '%s|%s|%s\\n' "$PWD" '${name}' "$*" >> "$WITNESS_LOG"\n${script}\n`);
        chmodSync(file, 0o755);
    };
    witness(
        'cargo',
        'if [ "${1:-}" = clippy ] && [ "${FAIL_CARGO:-}" = yes ]; then echo cargo-exit-37 >> "$WITNESS_LOG"; exit 37; fi'
    );
    witness(
        'npm',
        'if [ "${1:-}" = test ] && [ "${FAIL_NPM_TEST:-}" = yes ]; then echo npm-exit-23 >> "$WITNESS_LOG"; exit 23; fi'
    );
    const env = {
        ...process.env,
        CI: 'true',
        PATH: [bin, dirname(process.execPath), process.env.PATH ?? ''].join(delimiter),
        WITNESS_LOG: commandLog,
    };
    const launch = (program: string, args: string[], extra = {}) =>
        spawnSync(program, args, { cwd: fixture, env: { ...env, ...extra }, encoding: 'utf8' });
    const isRecord = (value: unknown): value is Record<string, unknown> =>
        value !== null && typeof value === 'object' && !Array.isArray(value);
    const record = (value: unknown, label: string): Record<string, unknown> => {
        if (!isRecord(value)) {
            throw new TypeError(`${label} must be a mapping`);
        }
        return value;
    };
    const workflow = record(parseHealthGateWorkflows(root)['validation.yml'], 'validation workflow');
    const jobs = record(workflow.jobs, 'validation jobs');
    const rust = record(jobs.rust, 'Rust job');
    if (!Array.isArray(rust.steps)) {
        throw new TypeError('Rust job steps must be an array');
    }
    const step = rust.steps.find(
        (value) => record(value, 'Rust job step').name === 'Server and Rust workspace health gates'
    );
    const command = record(step, 'Rust health step').run;
    if (typeof command !== 'string') {
        throw new TypeError('Rust health step run must be a string');
    }
    expect(command).toBe('node --run health:server:full');
    const run = (extra = {}) => launch('sh', ['-c', command], extra);
    const commands = () => readFileSync(commandLog, 'utf8').trim().split('\n');
    const expected = [
        `${fixture}|cargo|fmt --all --check`,
        `${fixture}|cargo|clippy --workspace --exclude sourdaw-native --all-targets --all-features`,
        `${fixture}|cargo|test --workspace --exclude sourdaw-native --all-features`,
        `${fixture}|npm|--prefix server ls --depth=0 --silent --include=dev`,
        `${fixture}/server|npm|test`,
        `${fixture}/server|npm|run build`,
    ];
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(commands()).toEqual(expected);
    writeFileSync(commandLog, '');
    expect(run({ FAIL_CARGO: 'yes' }).status).toBe(1);
    expect(commands()).toEqual([...expected.slice(0, 2), 'cargo-exit-37']);
    writeFileSync(commandLog, '');
    expect(run({ FAIL_NPM_TEST: 'yes' }).status).toBe(1);
    expect(commands()).toEqual([...expected.slice(0, 5), 'npm-exit-23']);
});
