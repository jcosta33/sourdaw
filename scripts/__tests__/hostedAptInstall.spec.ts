// @vitest-environment node
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
    appendFileSync,
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
    if (fifo.status !== 0) throw new Error(fifo.stderr);
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
    return existsSync(path)
        ? readFileSync(path, 'utf8')
              .trim()
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line) as Event)
        : [];
}

async function observed(f: Fixture, name: string): Promise<Event> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        const event = events(f).find((entry) => entry.event === name);
        if (event) return event;
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
    if (start < 0) throw new Error(`missing ${step} in ${workflow}`);
    const following = source.slice(start).split('\n');
    const run = following.findIndex((line) => /^        run: \|$/.test(line));
    if (run < 0) throw new Error(`missing literal run block for ${step}`);
    const body: string[] = [];
    for (const line of following.slice(run + 1)) {
        if (line !== '' && !line.startsWith('          ')) break;
        body.push(line.slice(10));
    }
    return body.join('\n');
}

function startHelper(
    f: Fixture,
    mode: string
): { child: ChildProcess; result: Promise<{ code: number | null; output: string }> } {
    const args = [helper, '--deadline', '1h', '--', '/usr/bin/python3', installer, f.root, mode];
    const child = spawn(
        process.platform === 'linux' ? 'sudo' : 'bash',
        process.platform === 'linux'
            ? ['-n', 'env', `PATH=${f.env.PATH}`, `TMPDIR=${f.env.TMPDIR}`, 'bash', ...args]
            : args,
        {
            env: f.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );
    let output = '';
    child.stdout?.on('data', (chunk) => {
        output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
        output += String(chunk);
    });
    return { child, result: once(child, 'close').then(([code]) => ({ code: code as number | null, output })) };
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

    it('refuses a numeric private journal before launching a payload', async () => {
        const f = fixture();
        try {
            writeFileSync(join(f.root, 'db/updates/0000'), 'interrupted transaction\n');
            const run = startHelper(f, 'wait');
            const result = await run.result;
            expect(events(f).filter((event) => event.event === 'installer-start')).toEqual([]);
            expect(result.code).toBe(2);
            expect(result.output).toContain('package-state=dirty');
        } finally {
            rmSync(f.root, { recursive: true });
        }
    });
});

// Ubuntu CI must execute these against its actual systemd 255+ system manager.
// macOS has no systemd containment oracle: these are explicitly unrun there.
describe.skipIf(process.platform !== 'linux')('real systemd fake package transaction', () => {
    it('deadline after acknowledged unpack drains a TERM-ignoring separate session and preserves dirty state', async () => {
        const f = fixture();
        const run = startHelper(f, 'wait');
        let unit: string | undefined;
        try {
            const ready = await observed(f, 'child-ready');
            await observed(f, 'unpack-start');
            await observed(f, 'parent-ready');
            unit = ready.cgroup?.match(/\/(sourdaw-apt-[a-f0-9-]+\.service)\n?$/)?.[1];
            expect(unit, ready.cgroup).toBeDefined();
            if (!unit) throw new Error('fake installer did not observe its exact owned unit');
            appendFileSync(join(f.root, 'events.jsonl'), JSON.stringify({ event: 'deadline-requested', unit }) + '\n');
            const deadline = spawnSync('sudo', ['-n', 'systemctl', 'set-property', unit, 'RuntimeMaxSec=1us'], {
                encoding: 'utf8',
            });
            expect(deadline.status, deadline.stderr).toBe(0);
            const result = await run.result;
            expect(result.code, result.output).toBe(124);
            expect(result.output).toContain('containment=drained');
            expect(result.output).toContain('package-state=dirty');
            expect(events(f).filter((event) => event.event === 'installer-start')).toHaveLength(1);
            expect(existsSync(join(f.root, 'db/updates/0000'))).toBe(true);
        } finally {
            if (unit) spawnSync('sudo', ['-n', 'systemctl', 'stop', unit], { encoding: 'utf8' });
            // Retain this failed transaction's private journal for inspection.
        }
    }, 30_000);

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
            if (run.child.exitCode === 0) rmSync(f.root, { recursive: true });
        }
    }, 30_000);
});
