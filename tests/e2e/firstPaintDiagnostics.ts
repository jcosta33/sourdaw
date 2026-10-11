import type { Page } from '@playwright/test';

/**
 * Boot-progress evidence for the launch screen's first-paint wait (#4781). The
 * offline smoke leg failed on a head where the page logged `[vite] connected.`
 * and then nothing for the whole first-paint allowance, and the job kept no
 * trace, so the page state at timeout was unrecoverable. The console stream is
 * the one artifact every run already keeps in its log, so this module records
 * it per page from navigation start and turns it into a boot-phase diagnosis
 * when the wait times out: which boot milestones the page reached, when, and
 * which one it stalled at.
 *
 * The milestones are the app's own boot order, observed in every healthy run:
 * the Vite client connects, React mounts (the devtools banner), the bootstrap
 * WASM instantiates (`initSync`), and bootstrap logs `[capabilities]`
 * (src/app/bootstrap.ts) before the workspace shell mounts the launch overlay.
 */

/** Vite client finished handshaking with the dev server. */
export const VITE_CONNECTED_MARKER = '[vite] connected.';
/** react-dom's development banner: the first React render happened. */
export const REACT_FIRST_RENDER_MARKER = 'Download the React DevTools';
/** A WASM glue module instantiated: bootstrap's module graph is executing. */
export const WASM_BOOTED_MARKER = 'initSync(';
/** bootstrap's boot-time probe: the launch path's boot work is done. */
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
    reactFirstRenderAtMs: number | null;
    wasmBootedAtMs: number | null;
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
        reactFirstRenderAtMs: firstMarkerAtMs(timeline, REACT_FIRST_RENDER_MARKER),
        wasmBootedAtMs: firstMarkerAtMs(timeline, WASM_BOOTED_MARKER),
        capabilitiesLoggedAtMs: firstMarkerAtMs(timeline, CAPABILITIES_MARKER),
    };
}

/** The boot stage each milestone hands over to, indexed after the milestone. */
const NEXT_STAGES = [
    'the dev-server handshake',
    'the app module graph',
    'the WASM bootstrap',
    'the [capabilities] log',
];
const OVERLAY_MOUNT_STAGE = 'the launch overlay mount';

function stalledStageLabel(progress: FirstPaintBootProgress): string {
    const reached = [
        progress.viteConnectedAtMs,
        progress.reactFirstRenderAtMs,
        progress.wasmBootedAtMs,
        progress.capabilitiesLoggedAtMs,
    ];
    for (let index = reached.length - 1; index >= 0; index -= 1) {
        if (reached[index] !== null) {
            return NEXT_STAGES[index + 1] ?? OVERLAY_MOUNT_STAGE;
        }
    }
    return NEXT_STAGES[0] ?? OVERLAY_MOUNT_STAGE;
}

const CONSOLE_TAIL_LENGTH = 8;

function formatSeconds(atMs: number | null): string {
    return atMs === null ? 'never' : `+${(atMs / 1000).toFixed(1)}s`;
}

export type FirstPaintTimeoutDiagnosisInput = {
    timeline: FirstPaintTimeline;
    timeoutMs: number;
    waitedMs: number;
    underlyingMessage: string;
};

/**
 * The message a timed-out first-paint wait fails with. It carries the boot
 * phases the page reached and the console tail, so the CI log alone answers
 * "what was the page doing" — the evidence run 36202813096 could not provide
 * because the job uploads no trace artifact.
 */
export function format_first_paint_timeout_diagnosis({
    timeline,
    timeoutMs,
    waitedMs,
    underlyingMessage,
}: FirstPaintTimeoutDiagnosisInput): string {
    const progress = first_paint_boot_progress(timeline);
    const stages = [
        `Vite client connected ${formatSeconds(progress.viteConnectedAtMs)}`,
        `React first render ${formatSeconds(progress.reactFirstRenderAtMs)}`,
        `WASM booted ${formatSeconds(progress.wasmBootedAtMs)}`,
        `[capabilities] (bootstrap complete) ${formatSeconds(progress.capabilitiesLoggedAtMs)}`,
    ];
    const tail = timeline.events.slice(-CONSOLE_TAIL_LENGTH).map((event) => event.text);

    return [
        `The launch screen did not mount within ${timeoutMs}ms (the wait consumed ${Math.round(waitedMs)}ms).`,
        `Boot progress from the page console since navigation: ${stages.join('; ')}.`,
        `The wait most likely measured ${stalledStageLabel(progress)} rather than a warm launch-screen mount.`,
        tail.length > 0
            ? `Console tail:\n${tail.map((line) => `  ${line}`).join('\n')}`
            : 'The page logged no console messages.',
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
    const deadline = performance.now() + timeoutMs;
    for (;;) {
        if (firstMarkerAtMs(timeline, marker) !== null) {
            return;
        }
        const remainingMs = deadline - performance.now();
        if (remainingMs <= 0) {
            throw new Error(
                `The page never logged "${marker}" within ${timeoutMs}ms — the launch path's boot did not complete, so the run refuses to hand a cold server to the timed first-paint waits.`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(remainingMs, 100)));
    }
}
