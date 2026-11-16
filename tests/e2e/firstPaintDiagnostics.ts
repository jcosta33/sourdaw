import type { Page } from '@playwright/test';

/** Console observations associated with launch-screen first-paint waits. */
export const VITE_CONNECTED_MARKER = '[vite] connected.';
/** React DOM's development banner is emitted when its module is evaluated. */
export const REACT_DOM_EVALUATED_MARKER = 'Download the React DevTools';
/** A WASM glue module emitted its initSync warning. */
export const INIT_SYNC_WARNING_MARKER = 'initSync(';
/** The capability probe logged during bootstrap. */
export const CAPABILITIES_MARKER = '[capabilities]';

export type FirstPaintConsoleEvent = {
    /** Milliseconds since the timeline began (attachment ≈ navigation start). */
    atMs: number;
    text: string;
};

export type FirstPaintTimeline = {
    startedAtMs: number;
    events: FirstPaintConsoleEvent[];
};

const timelines = new WeakMap<Page, FirstPaintTimeline>();

/**
 * Start recording the page's console from now on, and return its timeline.
 * Idempotent per page, so callers that navigate (setupWorkspace, the warmup,
 * the smoke reopen path) attach before `goto` and the first-paint wait reads
 * the same timeline the navigation wrote.
 */
export function attach_first_paint_console(page: Page): FirstPaintTimeline {
    const existing = timelines.get(page);
    if (existing) {
        return existing;
    }

    const timeline: FirstPaintTimeline = { startedAtMs: performance.now(), events: [] };
    timelines.set(page, timeline);
    page.on('console', (message) => {
        timeline.events.push({ atMs: performance.now() - timeline.startedAtMs, text: message.text() });
    });
    return timeline;
}

export type FirstPaintBootProgress = {
    viteConnectedAtMs: number | null;
    reactDomEvaluatedAtMs: number | null;
    initSyncWarningAtMs: number | null;
    capabilitiesLoggedAtMs: number | null;
};

function firstMarkerAtMs(timeline: FirstPaintTimeline, marker: string): number | null {
    const event = timeline.events.find((candidate) => candidate.text.includes(marker));
    return event ? Math.round(event.atMs) : null;
}

/** Reduce the raw console stream to the boot milestones the page reached. */
export function first_paint_boot_progress(timeline: FirstPaintTimeline): FirstPaintBootProgress {
    return {
        viteConnectedAtMs: firstMarkerAtMs(timeline, VITE_CONNECTED_MARKER),
        reactDomEvaluatedAtMs: firstMarkerAtMs(timeline, REACT_DOM_EVALUATED_MARKER),
        initSyncWarningAtMs: firstMarkerAtMs(timeline, INIT_SYNC_WARNING_MARKER),
        capabilitiesLoggedAtMs: firstMarkerAtMs(timeline, CAPABILITIES_MARKER),
    };
}

const CONSOLE_TAIL_LENGTH = 8;

function formatSeconds(atMs: number | null): string {
    return atMs === null ? 'never' : `+${(atMs / 1000).toFixed(1)}s`;
}

function formatBootStages(timeline: FirstPaintTimeline): string {
    const progress = first_paint_boot_progress(timeline);
    return [
        `Vite client connected ${formatSeconds(progress.viteConnectedAtMs)}`,
        `React DOM module evaluated ${formatSeconds(progress.reactDomEvaluatedAtMs)}`,
        `initSync warning ${formatSeconds(progress.initSyncWarningAtMs)}`,
        `[capabilities] logged ${formatSeconds(progress.capabilitiesLoggedAtMs)}`,
    ].join('; ');
}

function formatConsoleTail(timeline: FirstPaintTimeline): string {
    const tail = timeline.events.slice(-CONSOLE_TAIL_LENGTH).map((event) => event.text);
    return tail.length > 0
        ? `Console tail:\n${tail.map((line) => `  ${line}`).join('\n')}`
        : 'The page logged no console messages.';
}

export type FirstPaintFailureDiagnosisInput = {
    timeline: FirstPaintTimeline;
    elapsedMs: number;
    underlyingMessage: string;
};

/** Evidence for a warmup failure that does not claim every failure was a timeout. */
export function format_first_paint_failure_diagnosis({
    timeline,
    elapsedMs,
    underlyingMessage,
}: FirstPaintFailureDiagnosisInput): string {
    return [
        `First-paint warmup failed after ${Math.round(elapsedMs)}ms.`,
        `Boot progress from the page console since navigation: ${formatBootStages(timeline)}.`,
        formatConsoleTail(timeline),
        `Underlying error: ${underlyingMessage}`,
    ].join('\n');
}

export type FirstPaintTimeoutDiagnosisInput = {
    timeline: FirstPaintTimeline;
    timeoutMs: number;
    waitedMs: number;
    underlyingMessage: string;
};

/**
 * The message a timed-out first-paint wait fails with. It carries the
 * observed console markers and the console tail without inferring a stalled phase.
 */
export function format_first_paint_timeout_diagnosis({
    timeline,
    timeoutMs,
    waitedMs,
    underlyingMessage,
}: FirstPaintTimeoutDiagnosisInput): string {
    return [
        `The launch screen did not mount within ${timeoutMs}ms (the wait consumed ${Math.round(waitedMs)}ms).`,
        `Boot progress from the page console since navigation: ${formatBootStages(timeline)}.`,
        formatConsoleTail(timeline),
        `Underlying Playwright error: ${underlyingMessage}`,
    ].join('\n');
}

/**
 * Hold until the page's console carries `marker`, bounded by `timeoutMs`.
 * The warmup gates its hand-over on the `[capabilities]` marker: the overlay
 * becoming visible is the app's first paint, while the cold launch path keeps
 * building and booting WASM past that point — the work a first test's timed
 * allowance must not have to measure (#4781).
 */
export async function wait_for_console_marker(
    timeline: FirstPaintTimeline,
    marker: string,
    timeoutMs: number
): Promise<void> {
    await wait_for_console_marker_from(timeline, marker, timeoutMs, 0);
}

async function wait_for_console_marker_from(
    timeline: FirstPaintTimeline,
    marker: string,
    timeoutMs: number,
    firstEvent: number
): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
        if (timeline.events.slice(firstEvent).some((event) => event.text.includes(marker))) {
            return;
        }
        const remainingMs = deadline - performance.now();
        if (remainingMs <= 0) {
            throw new Error(
                `The page never logged "${marker}" within ${timeoutMs}ms — the expected marker was absent, so the run refuses to hand a cold server to the timed first-paint waits.`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(remainingMs, 100)));
    }
}

export async function wait_for_console_marker_after(
    timeline: FirstPaintTimeline,
    marker: string,
    timeoutMs: number,
    navigate: () => Promise<unknown>
): Promise<void> {
    const firstNewEvent = timeline.events.length;
    await navigate();
    await wait_for_console_marker_from(timeline, marker, timeoutMs, firstNewEvent);
}
