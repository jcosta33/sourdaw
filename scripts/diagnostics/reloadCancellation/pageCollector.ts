import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { observeBrowserDocument } from './browserSignals.ts';
import { ORIGINAL_BROWSER } from './identity.ts';
import { createJournal, recordOf, requiredText, writeReceipt, type RecordObservation } from './journal.ts';
import { linuxIdentity, observeRendererIdentities } from './rendererIdentity.ts';
import { createWebSocketObserver, WEBSOCKET_EVENTS } from './websocket.ts';

import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';

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

function safeUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    try {
        const url = new URL(value);
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.href;
    } catch {
        return value.split('?')[0];
    }
}

export function transportEvent(name: string, payload: unknown): Record<string, unknown> {
    const event = recordOf(payload, name);
    const request = event.request && typeof event.request === 'object' ? recordOf(event.request, 'request') : {};
    const response = event.response && typeof event.response === 'object' ? recordOf(event.response, 'response') : {};
    const frame = event.frame && typeof event.frame === 'object' ? recordOf(event.frame, 'frame') : {};
    const initiator =
        event.initiator && typeof event.initiator === 'object' ? recordOf(event.initiator, 'initiator') : {};
    const stack = initiator.stack && typeof initiator.stack === 'object' ? recordOf(initiator.stack, 'stack') : {};
    const callFrames = Array.isArray(stack.callFrames) ? stack.callFrames : [];
    let exceptionText: unknown;
    if (typeof event.exceptionDetails === 'object' && event.exceptionDetails !== null) {
        exceptionText = recordOf(event.exceptionDetails, 'exception').text;
    }
    return {
        requestId: event.requestId,
        timestamp: event.timestamp,
        wallTime: event.wallTime,
        type: event.type,
        frameId: event.frameId ?? frame.id,
        loaderId: event.loaderId ?? frame.loaderId,
        parentId: frame.parentId,
        url: safeUrl(request.url ?? response.url ?? event.url ?? frame.url),
        method: request.method,
        status: response.status,
        mimeType: response.mimeType,
        encodedDataLength: event.encodedDataLength,
        errorText: event.errorText,
        canceled: event.canceled,
        name: event.name,
        reason: event.reason,
        initiator: {
            type: initiator.type,
            url: safeUrl(initiator.url),
            callFrames: callFrames.map((item: unknown) => {
                const call = recordOf(item, 'call frame');
                return {
                    functionName: call.functionName,
                    url: safeUrl(call.url),
                    lineNumber: call.lineNumber,
                    columnNumber: call.columnNumber,
                };
            }),
        },
        exceptionText,
    };
}

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
            const entries = recordOf(processes, 'browser processes').processInfo;
            if (Array.isArray(entries)) {
                for (const value of entries) {
                    const entry = recordOf(value, 'native browser process');
                    if (entry.type !== 'browser' || typeof entry.id !== 'number') continue;
                    try {
                        const identity = linuxIdentity(
                            entry.id,
                            Number(requiredText(process.env.RELOAD_DIAGNOSTIC_RUNNER_PID, 'runner pid'))
                        );
                        if (!identity.owned || identity.namespace !== identity.observerNamespace)
                            throw new Error('Native browser namespace/ownership unproved');
                        record('browser-native-identity', { identity });
                    } catch (error) {
                        record('browser-native-identity-unknown', { pid: entry.id, reason: String(error) });
                    }
                }
            }
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

function observeConsole(
    page: Page,
    profile: 'full' | 'transport',
    counts: Record<string, number>,
    errors: string[],
    record: RecordObservation
): void {
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
        if (profile === 'full') {
            record('console', { type: message.type(), text, location: message.location() });
        } else if (text.startsWith('[vite]') || text.includes('Failed to fetch dynamically imported module')) {
            record('console', {
                type: message.type(),
                text: text.slice(0, 512).replaceAll(/\?[^\s]+/g, '?<redacted>'),
            });
        }
    });
}

export async function attachPassiveObservations(
    page: Page,
    context: BrowserContext,
    browser: Browser,
    output: string,
    profile: 'full' | 'transport' = 'full'
): Promise<void> {
    if (browser.version() !== ORIGINAL_BROWSER) {
        throw new Error(`Expected original Chromium ${ORIGINAL_BROWSER}, got ${browser.version()}`);
    }
    const record = createJournal(resolve(output, 'browser-observations.jsonl'));
    const session = await context.newCDPSession(page);
    const websocket = createWebSocketObserver(record, profile === 'full');
    const counts: Record<string, number> = {};
    const errors: string[] = [];
    const settleRendererMappings = await observeRendererIdentities(
        browser,
        session,
        Number(requiredText(process.env.RELOAD_DIAGNOSTIC_RUNNER_PID, 'runner pid')),
        record
    );
    for (const name of PASSIVE_EVENTS) {
        session.on(name, (payload: unknown) => {
            counts[name] = (counts[name] ?? 0) + 1;
            try {
                record(name, profile === 'transport' ? transportEvent(name, payload) : payload);
            } catch (error) {
                errors.push(String(error));
                record('collector-event-unknown', { name, error: String(error) });
            }
        });
    }
    for (const name of WEBSOCKET_EVENTS) {
        session.on(name, (payload: unknown) => websocket.observe(name, payload));
    }
    if (profile === 'full') {
        session.on('Debugger.scriptParsed', (payload: unknown) => {
            void observeAppSettlement(session, payload, (kind, data) => {
                counts[kind] = (counts[kind] ?? 0) + 1;
                record(kind, data);
            }).catch((error: unknown) => {
                errors.push(String(error));
                record('App-logpoint-unknown', String(error));
            });
        });
    }
    if (profile === 'full') {
        session.on('Debugger.paused', (payload: unknown) => {
            errors.push('Unexpected debugger pause');
            record('unexpected-debugger-pause', payload);
        });
    }
    await session.send('Network.enable');
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    if (profile === 'full') {
        await session.send('Debugger.enable');
    }
    await session.send('Page.setLifecycleEventsEnabled', { enabled: true });
    observeConsole(page, profile, counts, errors, record);
    page.on('pageerror', (error) =>
        record('page-error', {
            message:
                profile === 'full' ? error.message : error.message.slice(0, 512).replaceAll(/\?[^\s]+/g, '?<redacted>'),
        })
    );
    page.on('crash', () => record('page-crash', {}));
    page.on('framenavigated', (frame) =>
        record('playwright-navigation', {
            url: profile === 'full' ? frame.url() : safeUrl(frame.url()),
            main: frame === page.mainFrame(),
        })
    );
    page.on('requestfailed', (request) =>
        record('playwright-request-failed', {
            url: profile === 'full' ? request.url() : safeUrl(request.url()),
            method: request.method(),
            failure: request.failure(),
        })
    );
    if (profile === 'full') {
        await page.addInitScript(observeBrowserDocument);
    }
    const stop = await sampleBrowserProcesses(browser, record);
    const limits = ['Absent events do not establish a cause; debugger and DOM observation can affect timing.'];
    if (profile === 'transport') {
        limits[0] =
            'No debugger or DOM observer is installed. App fulfillment and public control visibility are unknown when unobserved. Missing CDP events cannot prove absence before collector readiness.';
    }
    page.once('close', () => {
        stop();
        void settleRendererMappings()
            .then((mappings) =>
                writeReceipt(resolve(output, 'renderer-mapping-health.json'), { mappings, observed: mappings > 0 })
            )
            .catch((error: unknown) =>
                writeReceipt(resolve(output, 'renderer-mapping-health.json'), {
                    observed: false,
                    unknown: String(error),
                })
            );
        writeReceipt(resolve(output, 'collector-health.json'), {
            counts,
            errors,
            profile,
            websocket: websocket.health(),
            limits,
        });
    });
    counts['collector-ready'] = 1;
    record('collector-ready', { version: browser.version() });
}
