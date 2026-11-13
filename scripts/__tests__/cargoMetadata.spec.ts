import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';

import { afterEach, expect, it } from 'vitest';

import { cargoMetadata } from '../cargoMetadata';

const directory = mkdtempSync(join(tmpdir(), 'cargo-metadata-test-'));
const originalPath = process.env.PATH;
const originalLog = process.env.CARGO_METADATA_TEST_LOG;

afterEach(() => {
    process.env.PATH = originalPath;
    if (originalLog === undefined) {
        delete process.env.CARGO_METADATA_TEST_LOG;
    } else {
        process.env.CARGO_METADATA_TEST_LOG = originalLog;
    }
    rmSync(directory, { recursive: true, force: true });
});

it('selects the lane toolchain and runs both metadata shapes from outside its ancestors', () => {
    const lane = join(directory, 'lane');
    const config = join(lane, '.cargo', 'config.toml');
    const log = join(directory, 'calls.jsonl');
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(config, '[build]\nrustflags = []\n');
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    const rustup = join(bin, 'rustup');
    writeFileSync(
        rustup,
        `#!/usr/bin/env node\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.CARGO_METADATA_TEST_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');\nif (process.argv[2] === 'show') console.log('1.99.1-aarch64-apple-darwin (overridden by test)');\nelse console.log('{"ok":true}');\n`
    );
    chmodSync(rustup, 0o755);
    process.env.PATH = `${bin}:${originalPath ?? ''}`;
    process.env.CARGO_METADATA_TEST_LOG = log;
    expect(
        cargoMetadata(
            lane,
            ['--locked', '--format-version', '1', '--features', 'sourdaw-native/napi-addon'],
            100 * 1024 * 1024
        )
    ).toBe('{"ok":true}\n');
    expect(cargoMetadata(lane, ['--no-deps', '--format-version', '1'])).toBe('{"ok":true}\n');
    const calls = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    expect(calls).toEqual([
        { cwd: lane, args: ['show', 'active-toolchain'] },
        {
            cwd: parse(lane).root,
            args: [
                'run',
                '1.99.1-aarch64-apple-darwin',
                'cargo',
                '--config',
                config,
                'metadata',
                '--manifest-path',
                join(lane, 'Cargo.toml'),
                '--locked',
                '--format-version',
                '1',
                '--features',
                'sourdaw-native/napi-addon',
            ],
        },
        { cwd: lane, args: ['show', 'active-toolchain'] },
        {
            cwd: parse(lane).root,
            args: [
                'run',
                '1.99.1-aarch64-apple-darwin',
                'cargo',
                '--config',
                config,
                'metadata',
                '--manifest-path',
                join(lane, 'Cargo.toml'),
                '--no-deps',
                '--format-version',
                '1',
            ],
        },
    ]);
    writeFileSync(
        rustup,
        `#!/bin/sh\nif [ "$1" = show ]; then echo '1.99.1-aarch64-apple-darwin (overridden by test)'; else echo 'metadata failure sentinel' >&2; exit 31; fi\n`
    );
    expect(() => cargoMetadata(lane, ['--no-deps', '--format-version', '1'])).toThrow('metadata failure sentinel');
});
