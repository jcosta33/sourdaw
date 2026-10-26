// @vitest-environment node
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
    chmodSync,
    closeSync,
    constants,
    openSync,
    writeSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { setTimeout as poll } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

const helper = resolve('scripts/aptWithoutMicrosoftFeed.sh');
const installer = resolve('scripts/__tests__/fixtures/hostedAptInstall/installer.py');
const aptConfigStub = resolve('scripts/__tests__/fixtures/aptConfigStub/apt-config');
const routes = [
    ['validation.yml', 'Install Playwright browsers', '8m'],
    ['heavy-gates.yml', 'Install Playwright browsers', '8m'],
    ['nightly.yml', 'Install Playwright browsers', '8m'],
    ['validation.yml', 'Install ALSA development headers', '8m'],
    ['nightly.yml', 'Install ALSA development headers', '8m'],
    ['cargo-dependency-seed.yml', 'Install ALSA development headers', '8m'],
    ['quantum-measurements.yml', 'Install Google Chrome', '5m'],
];

type Event = { event: string; pid?: number; cgroup?: string; sid?: number; pgid?: number };
type Fixture = { root: string; env: NodeJS.ProcessEnv };

function executable(path: string, source: string) {
    writeFileSync(path, source);
    chmodSync(path, 0o755);
}

function fixture(): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-hosted-apt-'));
    for (const directory of ['bin', 'etc/sources.list.d', 'db/updates', 'tmp']) {
        mkdirSync(join(root, directory), { recursive: true });
    }
    writeFileSync(join(root, 'etc/sources.list'), '');
    writeFileSync(
        join(root, 'etc/sources.list.d/ubuntu.sources'),
        [
            'Types: deb',
            'URIs: http://archive.ubuntu.com/ubuntu',
            'Suites: noble',
            'Components: main',
            'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg',
            '',
        ].join('\n')
    );
    writeFileSync(join(root, 'db/status'), '');
    writeFileSync(join(root, 'audit'), '');
    const fifo = spawnSync('mkfifo', [join(root, 'control')], { encoding: 'utf8' });
    if (fifo.status !== 0) {
        throw new Error(fifo.stderr);
    }
    executable(
        join(root, 'bin/apt-config'),
        `#!/usr/bin/env bash
export FAKE_APT_SOURCE_LIST='${root}/etc/sources.list'
export FAKE_APT_SOURCE_PARTS='${root}/etc/sources.list.d'
export FAKE_APT_STATUS='${root}/db/status'
exec bash '${aptConfigStub}' "$@"
`
    );
    executable(
        join(root, 'bin/dpkg'),
        `#!/usr/bin/env bash
set -euo pipefail
[ "$#" -eq 2 ] && [ "$1" = '--admindir=${root}/db' ] && [ "$2" = --audit ] || exit 64
printf '{"event":"package-state"}\n' >> '${root}/events.jsonl'
cat '${root}/audit'
`
    );
    return {
        root,
        env: {
            ...process.env,
            PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
            TMPDIR: join(root, 'tmp'),
        },
    };
}

function events(f: Fixture): Event[] {
    const path = join(f.root, 'events.jsonl');
    if (!existsSync(path)) {
        return [];
    }
    return readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Event);
}

async function observed(f: Fixture, name: string): Promise<Event> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const event = events(f).find((entry) => entry.event === name);
        if (event) {
            return event;
        }
        await poll(10);
    }
    throw new Error(`missing acknowledged event ${name}: ${JSON.stringify(events(f))}`);
}

function control(f: Fixture, command: string) {
    const descriptor = openSync(join(f.root, 'control'), constants.O_WRONLY | constants.O_NONBLOCK);
    try {
        writeSync(descriptor, command);
    } finally {
        closeSync(descriptor);
    }
}

function installerStep(workflow: string, step: string): string {
    const source = readFileSync(resolve('.github/workflows', workflow), 'utf8');
    const start = source.indexOf(`- name: ${step}\n`);
    if (start < 0) {
        throw new Error(`missing ${step} in ${workflow}`);
    }
    const following = source.slice(start).split('\n');
    const run = following.findIndex((line) => /^ {8}run: \|$/.test(line));
    if (run < 0) {
        throw new Error(`missing literal run block for ${step}`);
    }
    const body: string[] = [];
    for (const line of following.slice(run + 1)) {
        if (line !== '' && !line.startsWith('          ')) {
            break;
        }
        body.push(line.slice(10));
    }
    return body.join('\n');
}

function startHelper(
    f: Fixture,
    mode: string,
    deadline = '1h'
): { child: ChildProcess; output: () => string; result: Promise<{ code: number | null; output: string }> } {
    const args = [helper, '--deadline', deadline, '--', '/usr/bin/python3', installer, f.root, mode];
    let command = 'bash';
    let commandArgs = args;
    if (process.platform === 'linux') {
        command = 'sudo';
        commandArgs = ['-n', 'env', `PATH=${f.env.PATH}`, `TMPDIR=${f.env.TMPDIR}`, 'bash', ...args];
    }
    const child = spawn(command, commandArgs, {
        env: f.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (chunk) => {
        output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
        output += String(chunk);
    });
    return {
        child,
        output: () => output,
        result: once(child, 'close').then(([code]) => ({ code: code as number | null, output })),
    };
}

async function outputValue(run: ReturnType<typeof startHelper>, pattern: RegExp): Promise<string> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const match = run.output().match(pattern);
        if (match?.[1]) {
            return match[1];
        }
        await poll(10);
    }
    throw new Error(`missing controller output ${pattern}: ${run.output()}`);
}

function unitFields(unit: string): string {
    const result = spawnSync(
        'sudo',
        [
            '-n',
            'systemctl',
            'show',
            unit,
            '--no-pager',
            '--property=Id,InvocationID,ControlGroup,ActiveState,SubState,LoadState',
        ],
        { encoding: 'utf8' }
    );
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
}

function pidRunning(pid: number): boolean {
    const result = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
    return result.status === 0 && result.stdout.trim() !== '' && !result.stdout.trim().startsWith('Z');
}

function ownedPidRunning(pid: number, cgroup: string): boolean {
    try {
        return readFileSync(`/proc/${pid}/cgroup`, 'utf8') === cgroup && pidRunning(pid);
    } catch {
        return false;
    }
}

// A process-control stub proves workflow control flow only. It is never a
// containment oracle; the Linux cases below use the real system manager.
describe('hosted root installation admission', () => {
    it.each(routes)('%s / %s invokes a failed root transaction once and blocks downstream', (workflow, step) => {
        const f = fixture();
        try {
            executable(
                join(f.root, 'bin/sudo'),
                `#!/usr/bin/env bash
printf '{"event":"root-install"}\n' >> '${f.root}/events.jsonl'
exit 100
`
            );
            executable(join(f.root, 'bin/sleep'), '#!/usr/bin/env bash\nexit 0\n');
            executable(
                join(f.root, 'bin/pnpm'),
                `#!/usr/bin/env bash
printf '{"event":"downstream"}\n' >> '${f.root}/events.jsonl'
`
            );
            const result = spawnSync('bash', ['-euo', 'pipefail', '-c', installerStep(workflow, step)], {
                env: f.env,
                encoding: 'utf8',
            });
            expect(result.status).not.toBe(0);
            expect(events(f).filter((event) => event.event === 'downstream')).toEqual([]);
            expect(events(f).filter((event) => event.event === 'root-install')).toHaveLength(1);
        } finally {
            rmSync(f.root, { recursive: true });
        }
    });

    it('re-observes the bound unit when its cgroup disappears during a read', () => {
        const probe = spawnSync('/usr/bin/python3', ['scripts/__tests__/fixtures/hostedAptInstall/observation.py'], {
            encoding: 'utf8',
        });
        expect(probe.status, probe.stderr).toBe(0);
    });

    it('fixture acknowledges a separate-session unpack before accepting finish', async () => {
        const f = fixture();
        const child = spawn('/usr/bin/python3', [installer, f.root, 'wait'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let diagnostic = '';
        child.stderr?.on('data', (chunk) => {
            diagnostic += String(chunk);
        });
        const ended = once(child, 'close');
        try {
            const ready = await observed(f, 'child-ready');
            await observed(f, 'unpack-start');
            await observed(f, 'parent-ready');
            expect(ready.pid).toBe(ready.sid);
            expect(ready.pgid).toBe(ready.sid);
            expect(existsSync(join(f.root, 'db/updates/0000'))).toBe(true);
            control(f, 'F');
            expect((await ended)[0]).toBe(0);
            expect(events(f).map((event) => event.event)).toEqual([
                'installer-start',
                'child-ready',
                'unpack-start',
                'parent-ready',
                'control-received',
                'configured',
                'parent-exit',
            ]);
            expect(existsSync(join(f.root, 'db/updates/0000'))).toBe(false);
        } catch (error) {
            console.error({ fixture: f.root, diagnostic, events: events(f), exitCode: child.exitCode });
            throw error;
        } finally {
            if (child.exitCode === null) {
                control(f, 'F');
                await ended;
            }
            rmSync(f.root, { recursive: true });
        }
    }, 15_000);
});

// Ubuntu CI must execute these against its actual systemd 255+ system manager.
// macOS has no systemd containment oracle: these are explicitly unrun there.
describe.skipIf(process.env.SOURDAW_SYSTEMD_TESTS !== '1')('real systemd fake package transaction', () => {
    it('requires the Linux system manager and passwordless sudo', () => {
        expect(process.platform).toBe('linux');
        const probe = spawnSync('sudo', ['-n', 'systemctl', 'show', '--property=Version', '--value'], {
            encoding: 'utf8',
        });
        expect(probe.status, probe.stderr).toBe(0);
        expect(Number.parseInt(probe.stdout, 10)).toBeGreaterThanOrEqual(255);
    });
    it('refuses a numeric private journal before launching a payload', async () => {
        const f = fixture();
        try {
            writeFileSync(join(f.root, 'db/updates/0000'), 'interrupted transaction\n');
            const run = startHelper(f, 'wait');
            const result = await run.result;
            expect(events(f).filter((event) => event.event === 'installer-start')).toEqual([]);
            expect(events(f).filter((event) => event.event === 'package-state')).toHaveLength(1);
            expect(result.code).toBe(2);
            expect(result.output).toContain('package-state=dirty');
        } finally {
            rmSync(f.root, { recursive: true });
        }
    });

    it('refuses an audited dirty or unreadable private status before launching', async () => {
        for (const state of ['dirty', 'unknown']) {
            const f = fixture();
            try {
                if (state === 'dirty') {
                    writeFileSync(join(f.root, 'audit'), 'fake-package half-configured\n');
                } else {
                    rmSync(join(f.root, 'db/status'));
                }
                const result = await startHelper(f, 'wait').result;
                expect(result.code, result.output).toBe(2);
                expect(result.output).toContain(`package-state=${state}`);
                expect(events(f).filter((event) => event.event === 'installer-start')).toEqual([]);
            } finally {
                if (state !== 'unknown') {
                    rmSync(f.root, { recursive: true });
                }
            }
        }
    });
    it('deadline after acknowledged unpack drains a TERM-ignoring separate session and preserves dirty state', async () => {
        const f = fixture();
        const run = startHelper(f, 'wait', '8s');
        const sibling = spawn('sleep', ['60'], { stdio: 'ignore' });
        let unit: string | undefined;
        try {
            const ready = await observed(f, 'child-ready');
            await observed(f, 'unpack-start');
            await observed(f, 'parent-ready');
            unit = ready.cgroup?.match(/\/(sourdaw-apt-[a-f0-9-]+\.service)\n?$/)?.[1];
            expect(unit, ready.cgroup).toBeDefined();
            if (!unit) {
                throw new Error('fake installer did not observe its exact owned unit');
            }
            expect(unitFields(unit)).toContain(`ControlGroup=/system.slice/${unit}`);
            expect(ownedPidRunning(ready.pid!, ready.cgroup!)).toBe(true);
            const result = await run.result;
            expect(result.code, result.output).toBe(124);
            expect(result.output).toContain('containment=drained');
            expect(result.output).toContain('package-state=dirty');
            expect(events(f).filter((event) => event.event === 'package-state')).toHaveLength(2);
            expect(events(f).filter((event) => event.event === 'installer-start')).toHaveLength(1);
            expect(existsSync(join(f.root, 'db/updates/0000'))).toBe(true);
            expect(ownedPidRunning(ready.pid!, ready.cgroup!)).toBe(false);
            expect(pidRunning(sibling.pid!)).toBe(true);
            const terminal = unitFields(unit);
            expect(terminal).not.toContain(`ControlGroup=/system.slice/${unit}`);
        } finally {
            if (unit) {
                spawnSync('sudo', ['-n', 'systemctl', 'stop', unit], { encoding: 'utf8' });
            }
            sibling.kill('SIGTERM');
            // Retain this failed transaction's private journal for inspection.
        }
    }, 40_000);

    it('retains early-exit parent ownership until its separate-session child completes', async () => {
        const f = fixture();
        const run = startHelper(f, 'early-exit');
        try {
            await observed(f, 'unpack-start');
            await observed(f, 'parent-exit');
            expect(run.child.exitCode).toBeNull();
            control(f, 'F');
            const result = await run.result;
            expect(result.code, result.output).toBe(0);
            expect(result.output).toContain('containment=drained');
            expect(result.output).toContain('package-state=clean');
            expect(events(f).filter((event) => event.event === 'installer-start')).toHaveLength(1);
        } finally {
            if (
                existsSync(join(f.root, 'db/updates/0000')) &&
                events(f).some((entry) => entry.event === 'child-ready')
            ) {
                try {
                    control(f, 'F');
                } catch {
                    /* No reader: already terminated. */
                }
            }
            // Unknown containment deliberately retains the private evidence.
            if (run.child.exitCode === 0) {
                rmSync(f.root, { recursive: true });
            }
        }
    }, 30_000);

    it('preserves the installer failure ahead of dirty postflight', async () => {
        const f = fixture();
        const run = startHelper(f, 'wait');
        try {
            await observed(f, 'unpack-start');
            await observed(f, 'parent-ready');
            control(f, 'X');
            const result = await run.result;
            expect(result.code, result.output).toBe(100);
            expect(result.output).toContain('containment=drained');
            expect(result.output).toContain('package-state=dirty');
            expect(events(f).filter((event) => event.event === 'installer-start')).toHaveLength(1);
        } finally {
            // The failed transaction's private journal remains available.
        }
    }, 30_000);

    it('refuses a dirty or lost postflight audit after a successful payload', async () => {
        for (const state of ['dirty', 'unknown']) {
            const f = fixture();
            const run = startHelper(f, 'wait');
            try {
                await observed(f, 'unpack-start');
                await observed(f, 'parent-ready');
                if (state === 'dirty') {
                    writeFileSync(join(f.root, 'audit'), 'fake-package half-configured\n');
                } else {
                    executable(join(f.root, 'bin/dpkg'), '#!/usr/bin/env bash\nexit 64\n');
                }
                control(f, 'F');
                const result = await run.result;
                expect(result.code, result.output).toBe(2);
                expect(result.output).toContain('containment=drained');
                expect(result.output).toContain(`package-state=${state}`);
                if (state === 'unknown') {
                    expect(result.output).toContain('retained evidence=');
                }
            } finally {
                if (state === 'dirty') {
                    rmSync(f.root, { recursive: true });
                }
            }
        }
    }, 30_000);

    it('cancels the bound unit, drains its TERM-ignoring worker, and reports cancellation', async () => {
        const f = fixture();
        const run = startHelper(f, 'wait');
        try {
            const ready = await observed(f, 'child-ready');
            await observed(f, 'unpack-start');
            await observed(f, 'parent-ready');
            const controller = Number(await outputValue(run, /controller-pid=(\d+)/));
            const identity = spawnSync('ps', ['-o', 'command=', '-p', String(controller)], { encoding: 'utf8' });
            expect(identity.status).toBe(0);
            expect(identity.stdout).toContain('hostedAptInstall.py');
            const sent = spawnSync('sudo', ['-n', 'kill', '-TERM', String(controller)], { encoding: 'utf8' });
            expect(sent.status, sent.stderr).toBe(0);
            const result = await run.result;
            expect(result.code, result.output).toBe(143);
            expect(result.output).toContain('containment=drained');
            expect(result.output).toContain('package-state=dirty');
            expect(ownedPidRunning(ready.pid!, ready.cgroup!)).toBe(false);
        } finally {
            // A cancellation keeps the private package journal for diagnosis.
        }
    }, 35_000);

    it('fails closed and retains evidence when the bound unit status disappears', async () => {
        const f = fixture();
        const run = startHelper(f, 'wait', '5s');
        let unit: string | undefined;
        try {
            const ready = await observed(f, 'child-ready');
            await observed(f, 'parent-ready');
            unit = ready.cgroup?.match(/\/(sourdaw-apt-[a-f0-9-]+\.service)\n?$/)?.[1];
            expect(unit, ready.cgroup).toBeDefined();
            if (!unit) {
                throw new Error('fake installer did not observe its exact owned unit');
            }
            expect(unitFields(unit)).toContain(`Id=${unit}`);
            executable(join(f.root, 'bin/systemctl'), '#!/usr/bin/env bash\nexit 64\n');
            const result = await run.result;
            expect(result.code, result.output).toBe(2);
            expect(result.output).toContain('containment=unknown');
            expect(result.output).toContain('retained evidence=');
        } finally {
            if (unit) {
                const observedUnit = unitFields(unit);
                if (observedUnit.includes(`Id=${unit}`)) {
                    spawnSync('sudo', ['-n', 'systemctl', 'stop', unit], { encoding: 'utf8' });
                }
            }
        }
    }, 30_000);
});
