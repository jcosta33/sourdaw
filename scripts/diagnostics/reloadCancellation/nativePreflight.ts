import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ORIGINAL_BROWSER } from './identity.ts';
import { createJournal, recordOf, requiredText, writeReceipt } from './journal.ts';
import { assertTraceControl, readNativeEvents, traceCommand } from './nativeTrace.ts';
import { superviseNativeControl } from './nativeSupervisor.ts';
import { linuxIdentity, observeRendererIdentities } from './rendererIdentity.ts';
import { assertTraceBinding, type BrowserTraceBinding, type TraceInstance } from './traceBinding.ts';

import type { AddressInfo } from 'node:net';

function quote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function runAfterNativeQualification(
    qualify: () => Promise<string>,
    execute: (wrapper: string) => Promise<number>
): Promise<number> {
    const wrapper = requiredText(await qualify(), 'qualified native browser wrapper');
    return execute(wrapper);
}

export async function qualifyNativeTracing(root: string, output: string, runtime: string): Promise<string> {
    return superviseNativeControl(
        root,
        ['exec', 'node', fileURLToPath(import.meta.url), root, output, runtime],
        output
    );
}

async function runNativeControls(root: string, output: string, runtime: string): Promise<string> {
    if (process.platform !== 'linux') throw new Error('Native trace qualification requires actual Linux');
    const directory = resolve(output, 'native-preflight');
    mkdirSync(directory, { recursive: true });
    const record = createJournal(resolve(directory, 'browser-identity.jsonl'));
    const binary = readFileSync('/usr/bin/strace');
    writeReceipt(resolve(directory, 'strace-binary.json'), {
        path: '/usr/bin/strace',
        sha256: createHash('sha256').update(binary).digest('hex'),
    });
    for (const mode of ['exit37', 'trap']) {
        const trace = resolve(directory, mode);
        const receipt = resolve(directory, `${mode}-parent-wait.json`);
        const result = await traceCommand(
            process.execPath,
            [resolve(runtime, 'nativeControl.ts'), mode, receipt],
            trace,
            false
        );
        const wait = JSON.parse(readFileSync(receipt, 'utf8')) as {
            pid: number;
            code: number | null;
            signal: string | null;
        };
        if (
            result.code !== 0 ||
            result.signal !== null ||
            (mode === 'exit37'
                ? wait.code !== 37 || wait.signal !== null
                : wait.code !== null || wait.signal !== 'SIGTRAP')
        ) {
            throw new Error(`Native ${mode} control did not produce the required actual parent wait result`);
        }
        const capture = JSON.parse(readFileSync(resolve(trace, 'capture.json'), 'utf8')) as {
            complete: boolean;
            partialLine: boolean;
            droppedEvents: number;
        };
        assertTraceControl(readNativeEvents(trace), wait, capture);
    }
    const require = createRequire(resolve(root, 'package.json'));
    const { chromium } = require('playwright') as typeof import('playwright');
    // Discover the default pinned headless executable from the actual browser, not the tracer PID or a guessed install path.
    const original = await chromium.launch();
    let executable: string;
    try {
        if (original.version() !== ORIGINAL_BROWSER) throw new Error('Native preflight browser version differs');
        const session = await original.newBrowserCDPSession();
        const processes = recordOf(await session.send('SystemInfo.getProcessInfo'), 'browser processes');
        if (!Array.isArray(processes.processInfo)) throw new Error('Browser process identity missing');
        const browser = processes.processInfo
            .map((value: unknown) => recordOf(value, 'process'))
            .filter((entry) => entry.type === 'browser');
        if (browser.length !== 1 || typeof browser[0]?.id !== 'number') throw new Error('Browser PID is ambiguous');
        const identity = linuxIdentity(browser[0].id, process.pid);
        if (!identity.owned || identity.namespace !== identity.observerNamespace)
            throw new Error('Browser namespace/ownership is unproved');
        executable = readlinkSync(`/proc/${identity.pid}/exe`);
        record('original-default-browser', {
            identity,
            executable,
            sha256: createHash('sha256').update(readFileSync(executable)).digest('hex'),
        });
    } finally {
        await original.close();
    }
    const wrapper = resolve(runtime, 'chromium-native-trace.sh');
    writeFileSync(
        wrapper,
        `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(resolve(runtime, 'nativeBrowserWrapper.ts'))} ${quote(executable)} ${quote(resolve(output, 'run/native-traces'))} "$@"\n`,
        { flag: 'wx', mode: 0o700 }
    );
    const server = createServer((request, response) => {
        response.setHeader('Content-Type', request.url === '/probe.js' ? 'text/javascript' : 'text/html');
        response.end(
            request.url === '/probe.js'
                ? 'globalThis.nativeTraceScriptLoaded = true;'
                : '<!doctype html><script src="/probe.js"></script>'
        );
    });
    const tracedPids = new Set<number>();
    const bindings: BrowserTraceBinding[] = [];
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
        const browser = await chromium.launch({ executablePath: wrapper });
        try {
            if (browser.version() !== ORIGINAL_BROWSER) throw new Error('Traced browser runtime differs');
            const browserSession = await browser.newBrowserCDPSession();
            const processes = recordOf(await browserSession.send('SystemInfo.getProcessInfo'), 'traced processes');
            if (!Array.isArray(processes.processInfo)) throw new Error('Traced browser processes missing');
            for (const value of processes.processInfo) {
                const entry = recordOf(value, 'traced process');
                if (entry.type !== 'browser' || typeof entry.id !== 'number') continue;
                const identity = linuxIdentity(entry.id, process.pid);
                if (
                    !identity.owned ||
                    identity.namespace !== identity.observerNamespace ||
                    readlinkSync(`/proc/${entry.id}/exe`) !== executable
                )
                    throw new Error('Traced browser native identity differs');
                tracedPids.add(entry.id);
                record('traced-browser-identity', identity);
            }
            if (tracedPids.size !== 1) throw new Error('Exactly one native browser identity required');
            const context = await browser.newContext();
            const page = await context.newPage();
            const session = await context.newCDPSession(page);
            const settled = await observeRendererIdentities(
                browser,
                session,
                process.pid,
                (kind, data) => {
                    record(kind, data);
                    if (kind === 'page-renderer-identity') {
                        const identity = recordOf(recordOf(data, 'renderer mapping').identity, 'renderer identity');
                        if (typeof identity.pid === 'number') tracedPids.add(identity.pid);
                        bindings.push(recordOf(data, 'renderer mapping').traceBinding as BrowserTraceBinding);
                    }
                },
                resolve(output, 'run/native-traces')
            );
            await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, { timeout: 15_000 });
            if (
                (await page.evaluate(() => Reflect.get(globalThis, 'nativeTraceScriptLoaded'))) !== true ||
                (await settled()) < 1
            ) {
                throw new Error('Actual traced browser Script/frame/loader/PID/namespace mapping did not qualify');
            }
        } finally {
            await browser.close();
        }
    } finally {
        await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
    }
    const traces = resolve(output, 'run/native-traces');
    const names = readdirSync(traces);
    if (names.length !== 1) throw new Error('Native browser control trace is missing or ambiguous');
    const trace = resolve(traces, names[0]!);
    const capture = recordOf(
        JSON.parse(readFileSync(resolve(trace, 'capture.json'), 'utf8')) as unknown,
        'browser capture'
    );
    if (capture.complete !== true || capture.partialLine !== false || capture.droppedEvents !== 0)
        throw new Error('Native browser control tail is incomplete');
    if (!bindings.length) throw new Error('Native browser control trace instance was not bound');
    for (const binding of bindings) assertTraceBinding(binding, capture.traceInstance as TraceInstance);
    const nativeEvents = readNativeEvents(trace);
    for (const pid of tracedPids) {
        if (!nativeEvents.some((event) => event.pid === pid && event.kind === 'exit' && event.code === 0))
            throw new Error(`Native browser control normal exit missing for PID ${pid}`);
    }
    writeReceipt(resolve(directory, 'qualified.json'), {
        actualLinuxControls: true,
        parentWaitMatched: ['exit37', 'SIGTRAP'],
        pinnedBrowserScriptMapping: true,
        wrapper,
        advisoryOnly: true,
    });
    return wrapper;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const [root, output, runtime] = process.argv.slice(2);
    try {
        await runNativeControls(
            requiredText(root, 'source root'),
            requiredText(output, 'output root'),
            requiredText(runtime, 'materialized runtime')
        );
    } catch (error) {
        if (output)
            writeReceipt(resolve(output, 'native-preflight/control-failure.json'), {
                observed: false,
                appExecutionAdmitted: false,
                unknown: String(error),
            });
        process.stderr.write(`${String(error)}\n`);
        process.exitCode = 1;
    }
}
