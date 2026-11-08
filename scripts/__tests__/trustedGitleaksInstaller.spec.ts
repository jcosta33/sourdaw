// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { TLSSocket } from 'node:tls';

import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import type { Socket } from 'node:net';

const RELEASE_VERSION = '8.30.1';
const RELEASE_DIGEST = '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb';
const FIXTURE_EXECUTABLE = '#!/bin/sh\nprintf "installer fixture only\\n"\n';
const MAX_CHILD_MS = 20_000;
const MAX_OUTPUT_BYTES = 32_768;
const MAX_REQUESTS = 4;

function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('expected a workflow mapping');
    }
    return Object.fromEntries(Object.entries(value));
}

function text(value: unknown): string {
    if (typeof value !== 'string') {
        throw new TypeError('expected workflow text');
    }
    return value;
}

function installer() {
    const document = parseDocument(readFileSync(resolve('.github/workflows/validation.yml'), 'utf8'));
    expect(document.errors).toEqual([]);
    const workflow: unknown = document.toJS();
    const job = record(record(record(workflow).jobs)['pr-secrets']);
    const env = record(job.env);
    expect(env).toEqual({
        GITLEAKS_VERSION: RELEASE_VERSION,
        GITLEAKS_SHA256: RELEASE_DIGEST,
        BASE_SHA: '${{ github.event.pull_request.base.sha }}',
        HEAD_SHA: '${{ github.event.pull_request.head.sha }}',
    });
    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(job['timeout-minutes']).toBe(10);
    if (!Array.isArray(job.steps)) {
        throw new TypeError('expected pr-secrets steps');
    }
    const steps = job.steps.map((value: unknown) => record(value));
    function stepNamed(name: string) {
        const matches = steps.filter((step) => step.name === name);
        expect(matches, name).toHaveLength(1);
        const step = matches[0];
        if (!step) {
            throw new Error(`missing ${name}`);
        }
        return step;
    }
    const install = stepNamed('Install trusted Gitleaks');
    const positiveControl = stepNamed('Validate PR merge diff secret scanner');
    const scan = stepNamed('Scan pull request diff for secrets');
    expect(install['working-directory']).toBe('${{ github.workspace }}');
    expect(install.if).toBeUndefined();
    expect(positiveControl.if).toBeUndefined();
    expect(scan.if).toBeUndefined();
    expect(steps.indexOf(install)).toBeLessThan(steps.indexOf(positiveControl));
    expect(steps.indexOf(positiveControl)).toBeLessThan(steps.indexOf(scan));
    expect(record(positiveControl.env).GITLEAKS_EXPECTED_LEAK_EXIT_CODE).toBe(79);
    const controlRun = text(positiveControl.run);
    expect(controlRun).toContain('gitleaks git');
    expect(controlRun).toContain('"$positive_control_status" -ne "$GITLEAKS_EXPECTED_LEAK_EXIT_CODE"');
    const scanRun = text(scan.run);
    for (const run of [controlRun, scanRun]) {
        expect(run).toContain('--config "$GITHUB_WORKSPACE/trusted-scanner/.gitleaks.toml"');
        expect(run).toContain('--gitleaks-ignore-path "$GITHUB_WORKSPACE/trusted-scanner/.gitleaksignore"');
        expect(run).toContain('--ignore-gitleaks-allow');
    }
    expect(scanRun).toContain('--log-opts="$BASE_SHA..$HEAD_SHA -m"');
    expect(scanRun).toContain('"$GITHUB_WORKSPACE/scan-target/.git"');
    const run = text(install.run);
    expect(run).toContain('set -euo pipefail');
    expect(run).toContain('https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/');
    expect(run).toContain('"$GITLEAKS_SHA256" "$gitleaks_archive" | sha256sum --check --status');
    expect(run.indexOf('sha256sum --check --status')).toBeLessThan(run.indexOf('mkdir -p'));
    expect(run.indexOf('mkdir -p')).toBeLessThan(run.indexOf('tar -xzf'));
    expect(run.indexOf('tar -xzf')).toBeLessThan(run.indexOf('>> "$GITHUB_PATH"'));
    return { run, version: text(env.GITLEAKS_VERSION) };
}

function command(program: string, args: string[], cwd?: string): string {
    const result = spawnSync(program, args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: MAX_OUTPUT_BYTES });
    if (result.error || result.status !== 0) {
        throw new Error(`${program} failed: ${String(result.error)} ${result.stderr}`);
    }
    return result.stdout.trim();
}

function archive(root: string, name: string, executable: string): Buffer {
    const source = join(root, name);
    mkdirSync(source);
    writeFileSync(join(source, 'gitleaks'), executable, { mode: 0o755 });
    const target = join(root, `${name}.tar.gz`);
    command('tar', ['-czf', target, '-C', source, 'gitleaks']);
    expect(command('tar', ['-tzf', target])).toBe('gitleaks');
    return readFileSync(target);
}

function checksumTool() {
    if (process.platform === 'darwin') {
        return {
            program: '/usr/bin/shasum',
            prefix: ['-a', '256'],
            version: command('/usr/bin/shasum', ['--version']),
        };
    }
    if (process.platform !== 'linux') {
        throw new Error('installer fixture requires Linux sha256sum or the explicit Darwin Perl-SHA adapter');
    }
    const program = command('bash', ['-c', 'command -v sha256sum']);
    const version = command(program, ['--version']);
    return { program, prefix: [], version };
}

function checkDigest(tool: ReturnType<typeof checksumTool>, path: string, digest: string, matches: boolean) {
    const input = `${digest}  ${path}\n`;
    const result = spawnSync(tool.program, [...tool.prefix, '--check', '--status'], {
        input,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: MAX_OUTPUT_BYTES,
    });
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(matches ? 0 : 1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    if (matches) {
        return '';
    }
    // --status deliberately suppresses mismatch diagnostics in production.
    // Recheck the same bytes visibly so unsupported CLI options cannot count as
    // an integrity rejection merely because they also return nonzero.
    const diagnostic = spawnSync(tool.program, [...tool.prefix, '--check'], {
        input,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: MAX_OUTPUT_BYTES,
    });
    expect(diagnostic.error, diagnostic.stderr).toBeUndefined();
    expect(diagnostic.signal).toBeNull();
    expect(diagnostic.status, diagnostic.stderr).toBe(1);
    expect(diagnostic.stdout).toContain(`${path}: FAILED`);
    return diagnostic.stdout.trim();
}

type ResponseMode = 'recover' | 'exhaust' | 'wrong-archive' | 'immediate';

async function runInstaller(mode: ResponseMode) {
    // This tests the actual inline run. Only the external release bytes and their
    // separately asserted digest are replaced; this is never a scanner fixture.
    const subject = installer();
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-gitleaks-installer-'));
    const sockets = new Set<Socket>();
    const requests: { url: string | undefined; encrypted: boolean; status: number }[] = [];
    let server: ReturnType<typeof createServer> | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let completion: Promise<unknown> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
        const realCurl = command('bash', ['-c', 'command -v curl']);
        const curlVersion = command(realCurl, ['--version']);
        const approvedArchive = archive(root, 'approved-fixture', FIXTURE_EXECUTABLE);
        const wrongArchive = archive(root, 'wrong-fixture', '#!/bin/sh\nprintf "wrong fixture\\n"\n');
        const fixtureDigest = createHash('sha256').update(approvedArchive).digest('hex');
        expect(createHash('sha256').update(wrongArchive).digest('hex')).not.toBe(fixtureDigest);
        const checksum = checksumTool();
        const preflight = join(root, 'checksum-preflight');
        writeFileSync(preflight, approvedArchive);
        checkDigest(checksum, preflight, fixtureDigest, true);
        writeFileSync(preflight, wrongArchive);
        const preflightMismatch = checkDigest(checksum, preflight, fixtureDigest, false);
        console.info(JSON.stringify({ mode, checksumTool: checksum, preflightMatch: true, preflightMismatch }));
        const certificate = join(root, 'test-cert.pem');
        const key = join(root, 'test-key.pem');
        const config = join(root, 'test-openssl.cnf');
        writeFileSync(
            config,
            '[req]\ndistinguished_name=dn\nx509_extensions=extensions\n[dn]\n[extensions]\nsubjectAltName=DNS:github.com\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nextendedKeyUsage=serverAuth\n'
        );
        command('openssl', [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-nodes',
            '-days',
            '1',
            '-subj',
            '/CN=github.com',
            '-config',
            config,
            '-keyout',
            key,
            '-out',
            certificate,
        ]);
        server = createServer({ key: readFileSync(key), cert: readFileSync(certificate) }, (request, response) => {
            const status = mode === 'exhaust' || (mode === 'recover' && requests.length === 0) ? 504 : 200;
            requests.push({
                url: request.url,
                encrypted: request.socket instanceof TLSSocket && request.socket.encrypted,
                status,
            });
            if (requests.length > MAX_REQUESTS) {
                response.destroy(new Error('installer exceeded request bound'));
                return;
            }
            response.writeHead(status, { Connection: 'close' });
            let body = approvedArchive;
            if (status === 504) {
                body = Buffer.from('controlled upstream timeout body\n');
            } else if (mode === 'wrong-archive') {
                body = wrongArchive;
            }
            response.end(body);
        });
        server.on('connection', (socket) => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const address = server.address();
        if (address === null || typeof address === 'string') {
            throw new Error('HTTPS fixture did not bind a TCP port');
        }
        const bin = join(root, 'bin');
        const runnerTemp = join(root, 'runner-temp');
        mkdirSync(bin);
        mkdirSync(runnerTemp);
        if (process.platform === 'darwin') {
            // Test-only CLI compatibility: real Perl-SHA checks the bytes with
            // every original production argument. Linux uses its installed sha256sum.
            const checksumAdapter = join(bin, 'sha256sum');
            writeFileSync(checksumAdapter, '#!/bin/sh\nexec /usr/bin/shasum -a 256 "$@"\n');
            chmodSync(checksumAdapter, 0o755);
        }
        const githubPath = join(root, 'github-path');
        const argvLog = join(root, 'curl-argv');
        writeFileSync(githubPath, '');
        const adapter = join(bin, 'curl');
        writeFileSync(
            adapter,
            `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\0' "$@" > "$INSTALLER_TEST_ARGV"
exec "$INSTALLER_TEST_CURL" --connect-to "github.com:443:127.0.0.1:$INSTALLER_TEST_PORT" --cacert "$INSTALLER_TEST_CA" --noproxy '*' "$@"
`
        );
        chmodSync(adapter, 0o755);
        // A separate process group contains this Bash and its real curl/tar
        // children. Only that owned group is killed if the fixture bound fails.
        child = spawn('bash', ['-e', '-c', subject.run], {
            cwd: root,
            detached: true,
            env: {
                ...process.env,
                PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
                RUNNER_TEMP: runnerTemp,
                GITHUB_PATH: githubPath,
                GITLEAKS_VERSION: subject.version,
                GITLEAKS_SHA256: fixtureDigest,
                INSTALLER_TEST_ARGV: argvLog,
                INSTALLER_TEST_CURL: realCurl,
                INSTALLER_TEST_PORT: String(address.port),
                INSTALLER_TEST_CA: certificate,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let failure: string | undefined;
        const ownedChild = child;
        function stop(reason: string) {
            failure = reason;
            if (ownedChild.pid !== undefined && ownedChild.exitCode === null && ownedChild.signalCode === null) {
                process.kill(-ownedChild.pid, 'SIGKILL');
            }
        }
        function collect(chunk: Buffer) {
            if (Buffer.byteLength(output) + chunk.length > MAX_OUTPUT_BYTES) {
                stop('installer exceeded output bound');
                return;
            }
            output += chunk.toString();
        }
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        completion = once(child, 'close');
        deadline = setTimeout(() => stop('installer exceeded child lifetime bound'), MAX_CHILD_MS);
        const started = performance.now();
        await completion;
        clearTimeout(deadline);
        if (failure) {
            throw new Error(`${failure}: ${output}`);
        }
        const installDirectory = join(runnerTemp, `gitleaks-${subject.version}`);
        const member = join(installDirectory, 'gitleaks');
        const downloadedArchive = join(runnerTemp, `gitleaks_${subject.version}_linux_x64.tar.gz`);
        const args = readFileSync(argvLog, 'utf8').split('\0').slice(0, -1);
        const result = {
            code: child.exitCode,
            signal: child.signalCode,
            output,
            requests,
            args,
            elapsedMs: performance.now() - started,
            installed: existsSync(member) ? readFileSync(member, 'utf8') : undefined,
            directoryExists: existsSync(installDirectory),
            path: readFileSync(githubPath, 'utf8'),
            expectedPath: `${installDirectory}\n`,
            downloaded: existsSync(downloadedArchive) ? readFileSync(downloadedArchive) : undefined,
            wrongArchive,
            checksumMismatch:
                mode === 'wrong-archive' ? checkDigest(checksum, downloadedArchive, fixtureDigest, false) : undefined,
        };
        console.info(
            JSON.stringify({
                mode,
                curlVersion: curlVersion.split('\n')[0],
                code: result.code,
                signal: result.signal,
                requests,
                elapsedMs: result.elapsedMs,
                output,
            })
        );
        expect(result.signal).toBeNull();
        expect(result.elapsedMs).toBeLessThan(MAX_CHILD_MS);
        expect(args).toEqual([
            '--fail',
            '--location',
            '--proto',
            '=https',
            '--tlsv1.2',
            '--silent',
            '--show-error',
            '--retry',
            '3',
            '--retry-max-time',
            '120',
            '--connect-timeout',
            '10',
            '--max-time',
            '60',
            '--output',
            join(runnerTemp, `gitleaks_${subject.version}_linux_x64.tar.gz`),
            `https://github.com/gitleaks/gitleaks/releases/download/v${RELEASE_VERSION}/gitleaks_${RELEASE_VERSION}_linux_x64.tar.gz`,
        ]);
        expect(args[args.indexOf('--output') + 1]).toBe(
            join(runnerTemp, `gitleaks_${subject.version}_linux_x64.tar.gz`)
        );
        expect(args).not.toContain('--insecure');
        expect(args).not.toContain('-k');
        expect(args.at(-1)).toBe(
            `https://github.com/gitleaks/gitleaks/releases/download/v${RELEASE_VERSION}/gitleaks_${RELEASE_VERSION}_linux_x64.tar.gz`
        );
        expect(requests.length).toBeGreaterThan(0);
        expect(requests.length).toBeLessThanOrEqual(MAX_REQUESTS);
        for (const request of requests) {
            expect(request.encrypted).toBe(true);
            expect(request.url).toBe(
                `/gitleaks/gitleaks/releases/download/v${RELEASE_VERSION}/gitleaks_${RELEASE_VERSION}_linux_x64.tar.gz`
            );
        }
        return result;
    } finally {
        if (deadline) {
            clearTimeout(deadline);
        }
        if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
            process.kill(-child.pid, 'SIGKILL');
            await completion;
        }
        for (const socket of sockets) {
            socket.destroy();
        }
        if (server?.listening) {
            await new Promise<void>((_resolve, _reject) => {
                server?.close((error) => {
                    if (error) {
                        _reject(error);
                        return;
                    }
                    _resolve();
                });
            });
        }
        rmSync(root, { recursive: true, force: true });
    }
}

describe('actual trusted Gitleaks inline installer over HTTPS', () => {
    it('declares finite curl recovery and transfer bounds', () => {
        const { run } = installer();
        for (const option of ['--retry 3', '--retry-max-time 120', '--connect-timeout 10', '--max-time 60']) {
            expect(run).toContain(option);
        }
    });

    it('recovers one nonempty HTTP 504 before installing only verified bytes', async () => {
        const result = await runInstaller('recover');
        expect(result.code, result.output).toBe(0);
        expect(result.requests.map((request) => request.status)).toEqual([504, 200]);
        expect(result.installed).toBe(FIXTURE_EXECUTABLE);
        expect(result.path).toBe(result.expectedPath);
    }, 30_000);

    it('exhausts exactly four HTTP 504 attempts without admitting installation or PATH', async () => {
        const result = await runInstaller('exhaust');
        expect(result.code, result.output).toBe(22);
        expect(result.installed).toBeUndefined();
        expect(result.directoryExists).toBe(false);
        expect(result.path).toBe('');
        expect(result.requests.map((request) => request.status)).toEqual([504, 504, 504, 504]);
    }, 30_000);

    it('rejects a different valid tar before extraction, installation or PATH admission', async () => {
        const result = await runInstaller('wrong-archive');
        expect(result.code, result.output).toBe(1);
        expect(result.requests.map((request) => request.status)).toEqual([200]);
        expect(result.downloaded).toEqual(result.wrongArchive);
        expect(result.checksumMismatch).toContain(': FAILED');
        expect(result.installed).toBeUndefined();
        expect(result.directoryExists).toBe(false);
        expect(result.path).toBe('');
    }, 30_000);

    it('installs exact verified fixture bytes on immediate HTTPS success with one PATH line', async () => {
        const result = await runInstaller('immediate');
        expect(result.code, result.output).toBe(0);
        expect(result.requests.map((request) => request.status)).toEqual([200]);
        expect(result.installed).toBe(FIXTURE_EXECUTABLE);
        expect(result.path).toBe(result.expectedPath);
    }, 30_000);
});
