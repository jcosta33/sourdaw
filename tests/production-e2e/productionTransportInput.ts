import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';

type PublicState = { status: string; play: string; active: string };
type Point = { x: number; y: number };
type Rectangle = Point & { width: number; height: number };
type Geometry = {
    rect: Rectangle;
    frame: Point & { scaleX: number; scaleY: number };
    viewport: Point & { width: number; height: number };
};
type TransportEvent = {
    at: number;
    kind: 'state' | 'input';
    state: PublicState;
    phase?: string;
    event?: string;
    trusted?: boolean;
    sameTarget?: boolean;
    visible?: boolean;
    enabled?: boolean;
    connected?: boolean;
    geometry?: boolean;
    hit?: boolean;
    point?: boolean;
    raw?: string;
};
type AttemptBoundary = { observedEventCount: number };

export function assertTransportAdmission(count: number, visible: boolean, enabled: boolean): void {
    if (count !== 1 || !visible || !enabled) {
        throw new Error('Production Stop must be unique, visible and enabled before Play');
    }
}

export function createSingleInputAttempt(send: () => Promise<void>, milliseconds = 5_000): () => Promise<void> {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 5_000) {
        throw new Error('Native input budget must be positive and at most 5000ms');
    }
    let attempted = false;
    return async () => {
        if (attempted) {
            throw new Error('A second native input is forbidden, including after a deadline');
        }
        attempted = true;
        await withinBudget(send(), milliseconds);
    };
}

async function withinBudget(operation: Promise<void>, milliseconds: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await Promise.race([
            operation,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(new Error('Native input/observation deadline exceeded; pending input is not cancelled')),
                    milliseconds
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function stateIsPlaying(state: PublicState | undefined): boolean {
    return state?.status === 'Playing' && state.play === 'Pause' && state.active === 'true';
}

function stateBefore(events: TransportEvent[], index: number): PublicState | undefined {
    return events.slice(0, index).findLast((event) => event.kind === 'state')?.state;
}

function assertAttemptBoundary(events: TransportEvent[], attempt: AttemptBoundary): void {
    const count = attempt.observedEventCount;
    if (!Number.isInteger(count) || count < 0 || count > events.length) {
        throw new Error('Malformed production Stop journal boundary');
    }
}

function validateNativeInputOrder(inputs: TransportEvent[]): void {
    const order = [
        'pointerdown:capture',
        'pointerdown:bubble',
        'pointerup:capture',
        'pointerup:bubble',
        'click:capture',
        'click:bubble',
    ];
    for (const [index, event] of inputs.entries()) {
        const admitted = [
            event.trusted,
            event.sameTarget,
            event.visible,
            event.enabled,
            event.connected,
            event.geometry,
            event.hit,
            event.point,
        ];
        if (!admitted.every((value) => value === true)) {
            throw new Error(
                'Native Stop input was untrusted, missing, moved, hidden, covered or targeted another element'
            );
        }
        if (`${event.event}:${event.phase}` !== order[index]) {
            throw new Error('Native Stop events arrived out of order or more than once');
        }
    }
}

export function validateTransportStop(events: TransportEvent[], attempt: AttemptBoundary): boolean {
    assertAttemptBoundary(events, attempt);
    const inputs = events.slice(attempt.observedEventCount).filter((event) => event.kind === 'input');
    validateNativeInputOrder(inputs);
    if (inputs.length === 0) {
        return false;
    }
    if (!stateIsPlaying(stateBefore(events, attempt.observedEventCount))) {
        throw new Error('Stop input boundary was not preceded by public Playing/Pause');
    }
    const click = inputs.find((event) => event.event === 'click' && event.phase === 'capture');
    if (!click) {
        return false;
    }
    const clickIndex = events.indexOf(click);
    if (!stateIsPlaying(stateBefore(events, clickIndex)) || click.state.status !== 'Playing') {
        throw new Error('Stop click was not preceded by public Playing/Pause');
    }
    const stopped = events
        .slice(clickIndex + 1)
        .some(
            (event) =>
                event.kind === 'state' &&
                event.state.status === 'Stopped' &&
                event.state.play === 'Play' &&
                event.state.active === 'false'
        );
    return inputs.length === 6 && stopped && inputs.at(-1)?.state.status === 'Stopped';
}

function observationRecord(value: unknown): object {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Malformed production transport observation');
    }
    return value;
}

function observationString(value: object, key: string): string {
    const field: unknown = Reflect.get(value, key);
    if (typeof field !== 'string') {
        throw new Error('Malformed production transport observation');
    }
    return field;
}

function observationNumber(value: object, key: string): number {
    const field: unknown = Reflect.get(value, key);
    if (typeof field !== 'number' || !Number.isFinite(field)) {
        throw new Error('Malformed production transport geometry or timestamp');
    }
    return field;
}

function parseState(value: unknown): PublicState {
    const state = observationRecord(value);
    return {
        status: observationString(state, 'status'),
        play: observationString(state, 'play'),
        active: observationString(state, 'active'),
    };
}

function parsePoint(value: unknown): Point {
    const point = observationRecord(value);
    return { x: observationNumber(point, 'x'), y: observationNumber(point, 'y') };
}

function parseRectangle(value: unknown): Rectangle {
    const rectangle = observationRecord(value);
    return {
        ...parsePoint(rectangle),
        width: observationNumber(rectangle, 'width'),
        height: observationNumber(rectangle, 'height'),
    };
}

function parseGeometry(value: unknown): Geometry {
    const geometry = observationRecord(value);
    const frame = observationRecord(Reflect.get(geometry, 'frame'));
    return {
        rect: parseRectangle(Reflect.get(geometry, 'rect')),
        frame: {
            ...parsePoint(frame),
            scaleX: observationNumber(frame, 'scaleX'),
            scaleY: observationNumber(frame, 'scaleY'),
        },
        viewport: parseRectangle(Reflect.get(geometry, 'viewport')),
    };
}

function geometryMatches(initial: Geometry, current: Geometry): boolean {
    // The existing press visual moves one pixel vertically; other layout movement is refused.
    return (
        Math.abs(current.rect.x - initial.rect.x) <= 0.5 &&
        Math.abs(current.rect.y - initial.rect.y) <= 1.01 &&
        Math.abs(current.rect.width - initial.rect.width) <= 0.5 &&
        Math.abs(current.rect.height - initial.rect.height) <= 0.5 &&
        Math.abs(current.frame.x - initial.frame.x) <= 0.5 &&
        Math.abs(current.frame.y - initial.frame.y) <= 0.5 &&
        Math.abs(current.frame.scaleX - initial.frame.scaleX) < 0.0001 &&
        Math.abs(current.frame.scaleY - initial.frame.scaleY) < 0.0001 &&
        current.viewport.width === initial.viewport.width &&
        current.viewport.height === initial.viewport.height &&
        current.viewport.x === initial.viewport.x &&
        current.viewport.y === initial.viewport.y
    );
}

function pointMatches(current: Geometry, client: Point, main: Point): boolean {
    const { rect, frame } = current;
    return (
        client.x >= rect.x &&
        client.x <= rect.x + rect.width &&
        client.y >= rect.y &&
        client.y <= rect.y + rect.height &&
        Math.abs(frame.x + client.x * frame.scaleX - main.x) <= 0.5 &&
        Math.abs(frame.y + client.y * frame.scaleY - main.y) <= 0.5
    );
}

function observationBoolean(value: object, key: string): boolean {
    const observed: unknown = Reflect.get(value, key);
    if (typeof observed !== 'boolean') {
        throw new Error('Missing native event admission evidence');
    }
    return observed;
}

function parseInput(value: object) {
    const initial = parseGeometry(Reflect.get(value, 'initialGeometry'));
    const current = parseGeometry(Reflect.get(value, 'currentGeometry'));
    return {
        phase: observationString(value, 'phase'),
        event: observationString(value, 'event'),
        trusted: observationBoolean(value, 'trusted'),
        sameTarget: observationBoolean(value, 'sameTarget'),
        visible: observationBoolean(value, 'visible'),
        enabled: observationBoolean(value, 'enabled'),
        connected: observationBoolean(value, 'connected'),
        hit: observationBoolean(value, 'hit'),
        geometry: geometryMatches(initial, current),
        point: pointMatches(
            current,
            parsePoint(Reflect.get(value, 'frameClientPoint')),
            parsePoint(Reflect.get(value, 'mainPoint'))
        ),
    };
}

export function parseProductionTransportEvent(text: string): TransportEvent {
    const value = observationRecord(JSON.parse(text));
    const kind = observationString(value, 'kind');
    if (kind !== 'state' && kind !== 'input') {
        throw new Error('Malformed production transport observation');
    }
    const event: TransportEvent = {
        raw: text,
        at: observationNumber(value, 'at'),
        kind,
        state: parseState(Reflect.get(value, 'state')),
    };
    return kind === 'input' ? { ...event, ...parseInput(value) } : event;
}

// Each browser entry is self-contained: Playwright serializes its source without module closures.
export function observeProductionTransportState(original: Element, options: { marker: string }) {
    if (!(original instanceof HTMLButtonElement)) {
        throw new Error('Production Stop is not a native button');
    }
    const cluster = original.closest('[role="group"][aria-label="Playback controls"]');
    const host = window.frameElement;
    if (!cluster || !host || !host.clientWidth || !host.clientHeight) {
        throw new Error('Shipping frame geometry or Playback controls are unavailable');
    }
    const controls: Element = cluster;
    const rect = original.getBoundingClientRect();
    const frameRect = host.getBoundingClientRect();
    const geometry = {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        frame: {
            x: frameRect.x,
            y: frameRect.y,
            scaleX: frameRect.width / host.clientWidth,
            scaleY: frameRect.height / host.clientHeight,
        },
        viewport: { width: innerWidth, height: innerHeight, x: scrollX, y: scrollY },
    };
    let lastState = '';
    function observeState() {
        const play = controls.querySelector('[data-testid="transport-play"]');
        const state = {
            status: controls.querySelector('[role="status"]')?.textContent?.trim() ?? '',
            play: play?.getAttribute('aria-label') ?? '',
            active: play?.getAttribute('data-active') ?? '',
        };
        const next = JSON.stringify(state);
        if (next === lastState) {
            return;
        }
        lastState = next;
        console.info(
            options.marker + JSON.stringify({ at: Date.now(), performanceNow: performance.now(), kind: 'state', state })
        );
    }
    new MutationObserver(observeState).observe(controls, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['aria-label', 'data-active'],
    });
    observeState();
    return {
        geometry,
        hit:
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') ===
            original,
    };
}

export function installProductionTransportCapture(
    original: Element,
    options: { marker: string; initialGeometry: Geometry; point: Point }
) {
    if (!(original instanceof HTMLButtonElement)) {
        throw new Error('Production Stop is not a native button');
    }
    const button: HTMLButtonElement = original;
    const cluster = button.closest('[role="group"][aria-label="Playback controls"]');
    if (!cluster) {
        throw new Error('Production Stop is outside Playback controls');
    }
    const controls: Element = cluster;
    function frameGeometry() {
        const host = window.frameElement;
        if (!host || !host.clientWidth || !host.clientHeight) {
            throw new Error('Shipping frame geometry is unavailable');
        }
        const rect = host.getBoundingClientRect();
        return { x: rect.x, y: rect.y, scaleX: rect.width / host.clientWidth, scaleY: rect.height / host.clientHeight };
    }
    function visible() {
        for (let node: Element | null = button; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (
                node.hasAttribute('hidden') ||
                node.hasAttribute('inert') ||
                node.getAttribute('aria-hidden') === 'true' ||
                style.display === 'none' ||
                style.visibility !== 'visible' ||
                Number(style.opacity) === 0
            ) {
                return false;
            }
        }
        return true;
    }
    function capture(event: Event, type: string, phase: string) {
        if (!(event instanceof MouseEvent)) {
            return;
        }
        const rect = button.getBoundingClientRect();
        const target = event.composedPath().find((node) => node instanceof HTMLButtonElement);
        const play = controls.querySelector('[data-testid="transport-play"]');
        const state = {
            status: controls.querySelector('[role="status"]')?.textContent?.trim() ?? '',
            play: play?.getAttribute('aria-label') ?? '',
            active: play?.getAttribute('data-active') ?? '',
        };
        console.info(
            options.marker +
                JSON.stringify({
                    at: Date.now(),
                    performanceNow: performance.now(),
                    state,
                    kind: 'input',
                    phase,
                    event: type,
                    trusted: event.isTrusted,
                    sameTarget:
                        target === button &&
                        button.getAttribute('aria-label') === 'Stop' &&
                        button.getAttribute('data-testid') === 'transport-stop',
                    visible: visible(),
                    enabled: !button.disabled,
                    connected: button.isConnected,
                    hit: document.elementFromPoint(event.clientX, event.clientY)?.closest('button') === button,
                    initialGeometry: options.initialGeometry,
                    currentGeometry: {
                        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                        frame: frameGeometry(),
                        viewport: { width: innerWidth, height: innerHeight, x: scrollX, y: scrollY },
                    },
                    frameClientPoint: { x: event.clientX, y: event.clientY },
                    mainPoint: options.point,
                    currentTarget: event.currentTarget === document ? 'document' : 'other',
                })
        );
    }
    for (const phase of ['capture', 'bubble']) {
        for (const type of ['pointerdown', 'pointerup', 'click']) {
            document.addEventListener(type, (event) => capture(event, type, phase), {
                capture: phase === 'capture',
                passive: true,
            });
        }
    }
}

function assertMeasuredPoint(geometry: Geometry, point: Point, hit: boolean): void {
    const { rect, frame } = geometry;
    if (
        !hit ||
        Math.abs(frame.x + (rect.x + rect.width / 2) * frame.scaleX - point.x) > 0.5 ||
        Math.abs(frame.y + (rect.y + rect.height / 2) * frame.scaleY - point.y) > 0.5
    ) {
        throw new Error('Production Stop measured point is covered or mismatched');
    }
}

async function measureStop(page: Page, stop: Locator) {
    const count = await stop.count();
    if (count !== 1) {
        assertTransportAdmission(count, false, false);
    }
    const element = await stop.elementHandle();
    if (!element) {
        throw new Error('Production Stop disappeared before measured admission');
    }
    try {
        assertTransportAdmission(count, await element.isVisible(), await element.isEnabled());
        expect(await element.getAttribute('data-testid')).toBe('transport-stop');
        await element.click({ trial: true, timeout: 5_000 });
        const box = await element.boundingBox();
        const viewport = page.viewportSize();
        if (
            !box ||
            !viewport ||
            box.width <= 0 ||
            box.height <= 0 ||
            box.x < 0 ||
            box.y < 0 ||
            box.x + box.width > viewport.width ||
            box.y + box.height > viewport.height
        ) {
            throw new Error('Production Stop has no in-viewport measured geometry');
        }
        return { element, box, point: { x: box.x + box.width / 2, y: box.y + box.height / 2 } };
    } catch (error) {
        await element.dispose();
        throw error;
    }
}

function createObservationJournal(page: Page, marker: string) {
    const events: TransportEvent[] = [];
    let changed: (() => void) | undefined;
    let failure: unknown;
    const assertHealthy = () => {
        if (failure) {
            throw failure;
        }
    };
    const onConsole = (message: { text: () => string }) => {
        if (!message.text().startsWith(marker)) {
            return;
        }
        try {
            events.push(parseProductionTransportEvent(message.text().slice(marker.length)));
        } catch (error) {
            failure = error;
        }
        changed?.();
    };
    page.on('console', onConsole);
    return {
        events,
        assertHealthy,
        dispose: () => page.off('console', onConsole),
        waitForStop: async (boundary: AttemptBoundary) => {
            try {
                await withinBudget(
                    new Promise<void>((resolve, reject) => {
                        changed = () => {
                            try {
                                assertHealthy();
                                if (validateTransportStop(events, boundary)) {
                                    resolve();
                                }
                            } catch (error) {
                                reject(error);
                            }
                        };
                        changed();
                    }),
                    5_000
                );
            } finally {
                changed = undefined;
            }
        },
    };
}

async function assertPublicStopped(app: FrameLocator, controls: Locator, stop: Locator): Promise<void> {
    await expect(controls.getByRole('status')).toHaveText('Stopped', { timeout: 5_000 });
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(stop).toBeVisible({ timeout: 5_000 });
    await expect(app.getByTestId('transport-playhead')).toHaveText(/^Bars\s*27\s*\.\s*1\s*\.\s*000$/, {
        timeout: 5_000,
    });
}

export async function admitProductionTransportInput(page: Page, app: FrameLocator) {
    const controls = app.getByRole('group', { name: 'Playback controls', exact: true });
    const stop = controls.getByRole('button', { name: 'Stop', exact: true });
    await expect(controls.getByRole('status')).toHaveText('Stopped');
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    const { element, box, point } = await measureStop(page, stop);
    const marker = 'production-transport-input:';
    const journal = createObservationJournal(page, marker);
    try {
        const admission = await element.evaluate(observeProductionTransportState, { marker });
        const initialGeometry = parseGeometry(admission.geometry);
        assertMeasuredPoint(initialGeometry, point, admission.hit);
        await element.evaluate(installProductionTransportCapture, { marker, point, initialGeometry });
    } catch (error) {
        journal.dispose();
        throw error;
    } finally {
        await element.dispose();
    }
    const attempt = createSingleInputAttempt(() => page.mouse.click(point.x, point.y));
    return {
        snapshot: () => ({ box, point, events: [...journal.events] }),
        dispose: journal.dispose,
        stop: async () => {
            journal.assertHealthy();
            if (!stateIsPlaying(stateBefore(journal.events, journal.events.length))) {
                throw new Error('Public Playing/Pause was not observed before native Stop');
            }
            // No await/query intervenes between this append-only journal boundary and the single send.
            const boundary = { observedEventCount: journal.events.length };
            await attempt();
            await journal.waitForStop(boundary);
            await assertPublicStopped(app, controls, stop);
        },
    };
}
