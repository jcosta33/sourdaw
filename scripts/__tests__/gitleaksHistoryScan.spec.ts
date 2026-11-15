// @vitest-environment node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Socket } from 'node:net';

const VERSION = '8.30.1';
const MAX_CHILD_MS = 20_000;
const MAX_OUTPUT_BYTES = 32_768;
const TRUSTED_ROOT = resolve('.');
const HELPER = join(TRUSTED_ROOT, 'scripts/run-gitleaks-history-scan.sh');
const FIXTURE_EXECUTABLE = '#!/bin/sh\nprintf \'%s\\0\' "$@" > "$HISTORY_TEST_SCAN_ARGS"\nexit "$GITLEAKS_EXIT_CODE"\n';

function command(program: string, args: string[]) {
    const result = spawnSync(program, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: MAX_OUTPUT_BYTES });
    if (result.error || result.status !== 0) {
        throw new Error(`${program} failed: ${String(result.error)} ${result.stderr}`);
    }
    return result.stdout.trim();
}

type ResponseMode = 'recover' | 'exhaust' | 'wrong-archive';

async function runHistoryScan(mode: ResponseMode) {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-gitleaks-history-'));
    const sockets = new Set<Socket>();
    const statuses: number[] = [];
    let server: ReturnType<typeof createServer> | undefined;
    let child: ReturnType<typeof spawn> | undefined;
    let completion: Promise<unknown> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
        const source = join(root, 'source');
        const archive = join(root, 'approved.tar.gz');
        mkdirSync(source);
        writeFileSync(join(source, 'gitleaks'), FIXTURE_EXECUTABLE, { mode: 0o755 });
        command('tar', ['-czf', archive, '-C', source, 'gitleaks']);
        const approved = readFileSync(archive);
        const digest = createHash('sha256').update(approved).digest('hex');
        // A different valid archive distinguishes checksum refusal from tar failure.
        writeFileSync(join(source, 'gitleaks'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        command('tar', ['-czf', archive, '-C', source, 'gitleaks']);
        const wrong = readFileSync(archive);
        expect(createHash('sha256').update(wrong).digest('hex')).not.toBe(digest);
        const certificate = join(root, 'certificate.pem');
        const key = join(root, 'key.pem');
        const config = join(root, 'openssl.cnf');
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
        server = createServer({ key: readFileSync(key), cert: readFileSync(certificate) }, (_request, response) => {
            const status = mode === 'exhaust' || (mode === 'recover' && statuses.length === 0) ? 502 : 200;
            statuses.push(status);
            if (statuses.length > 4) {
                response.destroy(new Error('history scan exceeded request bound'));
                return;
            }
            response.writeHead(status, { Connection: 'close' });
            let body = approved;
            if (status === 502) {
                body = Buffer.from('controlled upstream failure\n');
            } else if (mode === 'wrong-archive') {
                body = wrong;
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
        const realCurl = command('bash', ['-c', 'command -v curl']);
        const bin = join(root, 'bin');
        const runnerTemp = join(root, 'runner-temp');
        const scanArgs = join(root, 'scan-args');
        const curlArgs = join(root, 'curl-args');
        const scanTarget = join(root, 'untrusted-target.git');
        mkdirSync(bin);
        mkdirSync(scanTarget);
        writeFileSync(join(scanTarget, '.gitleaks.toml'), '[allowlist]\npaths = [".*"]\n');
        writeFileSync(join(scanTarget, '.gitleaksignore'), '*\n');
        if (process.platform === 'darwin') {
            // Real Perl-SHA checks the original arguments on Darwin; Linux uses sha256sum.
            writeFileSync(join(bin, 'sha256sum'), '#!/bin/sh\nexec /usr/bin/shasum -a 256 "$@"\n', { mode: 0o755 });
        } else if (process.platform !== 'linux') {
            throw new Error('history scan fixture requires Linux or Darwin checksum tooling');
        }
        writeFileSync(
            join(bin, 'curl'),
            `#!/bin/sh
printf '%s\\0' "$@" > "$HISTORY_TEST_CURL_ARGS"
exec "$HISTORY_TEST_CURL" --connect-to "github.com:443:127.0.0.1:$HISTORY_TEST_PORT" --cacert "$HISTORY_TEST_CA" --noproxy '*' "$@"
`,
            { mode: 0o755 }
        );
        child = spawn('sh', [HELPER, scanTarget], {
            cwd: root,
            detached: true,
            env: {
                ...process.env,
                PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
                RUNNER_TEMP: runnerTemp,
                GITLEAKS_VERSION: VERSION,
                GITLEAKS_SHA256: digest,
                GITLEAKS_EXIT_CODE: '79',
                HISTORY_TEST_SCAN_ARGS: scanArgs,
                HISTORY_TEST_CURL_ARGS: curlArgs,
                HISTORY_TEST_CURL: realCurl,
                HISTORY_TEST_PORT: String(address.port),
                HISTORY_TEST_CA: certificate,
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
                stop('history scan exceeded output bound');
                return;
            }
            output += chunk.toString();
        }
        child.stdout?.on('data', collect);
        child.stderr?.on('data', collect);
        completion = once(child, 'close');
        deadline = setTimeout(() => stop('history scan exceeded lifetime bound'), MAX_CHILD_MS);
        await completion;
        clearTimeout(deadline);
        if (failure) {
            throw new Error(`${failure}: ${output}`);
        }
        expect(child.signalCode).toBeNull();
        const args = readFileSync(curlArgs, 'utf8').split('\0').slice(0, -1);
        const installDirectory = join(runnerTemp, `gitleaks-${VERSION}`);
        console.info(JSON.stringify({ mode, statuses, code: child.exitCode, output }));
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
            join(runnerTemp, `gitleaks_${VERSION}_linux_x64.tar.gz`),
            `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz`,
        ]);
        return {
            code: child.exitCode,
            output,
            statuses,
            installed: existsSync(installDirectory),
            scannerArgs: existsSync(scanArgs) ? readFileSync(scanArgs, 'utf8').split('\0').slice(0, -1) : undefined,
            scanTarget,
        };
    } finally {
        if (deadline) clearTimeout(deadline);
        if (child?.pid !== undefined && child.exitCode === null && child.signalCode === null) {
            process.kill(-child.pid, 'SIGKILL');
            await completion;
        }
        for (const socket of sockets) socket.destroy();
        if (server?.listening) {
            await new Promise<void>((resolveClose, reject) => {
                server?.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolveClose();
                });
            });
        }
        rmSync(root, { recursive: true, force: true });
    }
}

describe('trusted history scanner download and execution', () => {
    it('recovers a nonempty HTTP 502 and preserves trusted scan flags and leak exit', async () => {
        const result = await runHistoryScan('recover');
        expect(result.statuses).toEqual([502, 200]);
        expect(result.code, result.output).toBe(79);
        expect(result.scannerArgs).toEqual([
            'git',
            '--config',
            join(TRUSTED_ROOT, '.gitleaks.toml'),
            '--gitleaks-ignore-path',
            join(TRUSTED_ROOT, '.gitleaksignore'),
            '--ignore-gitleaks-allow',
            '--no-banner',
            '--no-color',
            '--redact=100',
            '--verbose',
            '--exit-code=79',
            '--log-opts=--all',
            result.scanTarget,
        ]);
    }, 30_000);

    it('exhausts four HTTP 502 attempts without extracting or scanning', async () => {
        const result = await runHistoryScan('exhaust');
        expect(result.statuses).toEqual([502, 502, 502, 502]);
        expect(result.code, result.output).toBe(22);
        expect(result.installed).toBe(false);
        expect(result.scannerArgs).toBeUndefined();
    }, 30_000);

    it('rejects different valid archive bytes before extraction or scanning', async () => {
        const result = await runHistoryScan('wrong-archive');
        expect(result.statuses).toEqual([200]);
        expect(result.code, result.output).toBe(1);
        expect(result.installed).toBe(false);
        expect(result.scannerArgs).toBeUndefined();
    }, 30_000);
});
