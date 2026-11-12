import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join, parse } from 'node:path';

export function cargoMetadata(root: string, args: string[], maxBuffer?: number): string {
    const workspace = realpathSync(root);
    const toolchain = execFileSync('rustup', ['show', 'active-toolchain'], {
        cwd: workspace,
        encoding: 'utf8',
    })
        .trim()
        .split(/\s+/u)[0];
    if (!toolchain) {
        throw new Error('rustup did not report an active toolchain');
    }
    const legacyConfig = join(workspace, '.cargo', 'config');
    const tomlConfig = join(workspace, '.cargo', 'config.toml');
    let config: string | undefined;
    if (existsSync(legacyConfig)) {
        config = legacyConfig;
    } else if (existsSync(tomlConfig)) {
        config = tomlConfig;
    }
    const commandArgs = ['run', toolchain, 'cargo'];
    if (config !== undefined) {
        commandArgs.push('--config', config);
    }
    commandArgs.push('metadata', '--manifest-path', join(workspace, 'Cargo.toml'), ...args);
    const options: { cwd: string; encoding: 'utf8'; maxBuffer?: number } = {
        cwd: parse(workspace).root,
        encoding: 'utf8',
    };
    if (maxBuffer !== undefined) {
        options.maxBuffer = maxBuffer;
    }
    return execFileSync('rustup', commandArgs, options);
}
