import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';

import { observeBrowserDocument } from './browserSignals.ts';
import { ORIGINAL_BROWSER } from './identity.ts';
import { createJournal, recordOf, requiredText, writeReceipt, type RecordObservation } from './journal.ts';
import { createWebSocketObserver, WEBSOCKET_EVENTS } from './websocket.ts';

const PASSIVE_EVENTS = [
    'Network.requestWillBeSent',
    'Network.responseReceived',
    'Network.loadingFailed',
    'Network.loadingFinished',
    'Page.frameStartedNavigating',
    'Page.frameRequestedNavigation',
    'Page.frameNavigated',
    'Page.frameStartedLoading',
    'Page.frameStoppedLoading',
    'Page.lifecycleEvent',
    'Runtime.exceptionThrown',
    'Inspector.targetCrashed',
] as const;

async function observeAppSettlement(session: CDPSession, event: unknown, record: RecordObservation): Promise<void> {
    const parsed = recordOf(event, 'scriptParsed');
    const url = parsed.url;
    if (typeof url !== 'string' || !/\/src\/app\/main\.tsx(?:\?|$)/.test(url)) {
        return;
    }
    const scriptId = requiredText(parsed.scriptId, 'scriptId');
    const response: unknown = await session.send('Debugger.getScriptSource', { scriptId });
    const source = requiredText(recordOf(response, 'script source').scriptSource, 'scriptSource');
    const lines = source.split('\n');
    const importing = lines.findIndex(
        (line) => line.includes('import(') && /App(?:\.tsx)?/.test(line) && line.includes('.then')
    );
    const target = lines.findIndex(
        (line, index) => index > importing && index < importing + 5 && line.includes('reactRoot.render')
    );
    if (importing < 0 || target < 0) {
        throw new Error('Actual App fulfillment render statement was not found');
    }
    // A false-condition logpoint observes the real fulfillment body without pausing or replacing it.
    const condition =
        'console.debug("[reload-cancellation-app-fulfilled]",JSON.stringify({timeOrigin:performance.timeOrigin,performanceNow:performance.now()})), false';
    const result: unknown = await session.send('Debugger.setBreakpoint', {
        location: { scriptId, lineNumber: target, columnNumber: 0 },
        condition,
    });
    const breakpoint = recordOf(result, 'breakpoint');
    const actual = recordOf(breakpoint.actualLocation, 'actualLocation');
    if (actual.scriptId !== scriptId || actual.lineNumber !== target) {
        throw new Error('App logpoint moved outside the actual fulfillment statement');
    }
    record('App-logpoint-installed', {
        url,
        scriptId,
        importing,
        target,
        actual,
        sourceLines: lines.slice(importing, target + 2),
        compiledSourceSha256: createHash('sha256').update(source).digest('hex'),
    });
}

async function sampleBrowserProcesses(browser: Browser, record: RecordObservation): Promise<() => void> {
    const root = await browser.newBrowserCDPSession();
    let pending = false;
    const sample = async (): Promise<void> => {
        if (pending) {
            return;
        }
        pending = true;
        try {
            const processes: unknown = await root.send('SystemInfo.getProcessInfo');
            record('browser-processes', processes);
        } catch (error) {
            record('browser-process-observation-unknown', String(error));
        } finally {
            pending = false;
        }
    };
    await sample();
    const timer = setInterval(() => {
        void sample();
    }, 2_000);
    timer.unref();
    return () => clearInterval(timer);
}

export async function attachPassiveObservations(
    page: Page,
    context: BrowserContext,
    browser: Browser,
    output: string
): Promise<void> {
    if (browser.version() !== ORIGINAL_BROWSER) {
        throw new Error(`Expected original Chromium ${ORIGINAL_BROWSER}, got ${browser.version()}`);
    }
    const record = createJournal(resolve(output, 'browser-observations.jsonl'));
    const session = await context.newCDPSession(page);
    const websocket = createWebSocketObserver(record);
    const counts: Record<string, number> = {};
    const errors: string[] = [];
    for (const name of PASSIVE_EVENTS) {
        session.on(name, (payload: unknown) => {
            counts[name] = (counts[name] ?? 0) + 1;
            record(name, payload);
        });
    }
    for (const name of WEBSOCKET_EVENTS) {
        session.on(name, (payload: unknown) => websocket.observe(name, payload));
    }
    session.on('Debugger.scriptParsed', (payload: unknown) => {
        void observeAppSettlement(session, payload, (kind, data) => {
            counts[kind] = (counts[kind] ?? 0) + 1;
            record(kind, data);
        }).catch((error: unknown) => {
            errors.push(String(error));
            record('App-logpoint-unknown', String(error));
        });
    });
    session.on('Debugger.paused', (payload: unknown) => {
        errors.push('Unexpected debugger pause');
        record('unexpected-debugger-pause', payload);
    });
    for (const domain of ['Network', 'Page', 'Runtime', 'Debugger']) {
        await session.send(`${domain}.enable`);
    }
    await session.send('Page.setLifecycleEventsEnabled', { enabled: true });
    page.on('console', (message) => {
        const text = message.text();
        if (text.startsWith('[reload-cancellation-app-fulfilled] ')) {
            counts['App-fulfilled'] = (counts['App-fulfilled'] ?? 0) + 1;
        }
        if (text.startsWith('[reload-cancellation-observation] ')) {
            try {
                const parsed: unknown = JSON.parse(text.slice('[reload-cancellation-observation] '.length));
                const event = recordOf(parsed, 'DOM observation');
                if (event.kind === 'document-init' || event.kind === 'public-dom-transition') {
                    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
                    if (
                        event.kind === 'public-dom-transition' &&
                        recordOf(event.data, 'DOM facts').controlsVisible === true
                    ) {
                        counts['public-transport-visible'] = (counts['public-transport-visible'] ?? 0) + 1;
                    }
                }
            } catch (error) {
                errors.push(String(error));
            }
        }
        record('console', { type: message.type(), text, location: message.location() });
    });
    page.on('pageerror', (error) => record('page-error', { message: error.message, stack: error.stack }));
    page.on('crash', () => record('page-crash', {}));
    page.on('framenavigated', (frame) =>
        record('playwright-navigation', { url: frame.url(), main: frame === page.mainFrame() })
    );
    page.on('requestfailed', (request) =>
        record('playwright-request-failed', {
            url: request.url(),
            method: request.method(),
            failure: request.failure(),
        })
    );
    await page.addInitScript(observeBrowserDocument);
    const stop = await sampleBrowserProcesses(browser, record);
    page.once('close', () => {
        stop();
        writeReceipt(resolve(output, 'collector-health.json'), {
            counts,
            errors,
            websocket: websocket.health(),
            limits: ['Absent events do not establish a cause; debugger and DOM observation can affect timing.'],
        });
    });
    counts['collector-ready'] = 1;
    record('collector-ready', { version: browser.version() });
}
