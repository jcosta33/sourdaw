import { expect, type FrameLocator, type Page } from '@playwright/test';

type PublicState = { status: string; play: string; active: string };
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
        if (attempted) throw new Error('A second native input is forbidden, including after a deadline');
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

export function validateTransportStop(events: TransportEvent[], startedAt: number): boolean {
    const inputs = events.filter((event) => event.kind === 'input' && event.at >= startedAt);
    const order = [
        'pointerdown:capture',
        'pointerdown:bubble',
        'pointerup:capture',
        'pointerup:bubble',
        'click:capture',
        'click:bubble',
    ];
    for (const [index, event] of inputs.entries()) {
        if (
            !event.trusted ||
            !event.sameTarget ||
            !event.visible ||
            !event.enabled ||
            !event.connected ||
            !event.geometry ||
            !event.hit ||
            !event.point
        ) {
            throw new Error(
                'Native Stop input was untrusted, missing, moved, hidden, covered or targeted another element'
            );
        }
        if (`${event.event}:${event.phase}` !== order[index])
            throw new Error('Native Stop events arrived out of order or more than once');
    }
    const click = inputs.find((event) => event.event === 'click' && event.phase === 'capture');
    if (!click) return false;
    const clickIndex = events.indexOf(click);
    const playing = events.slice(0, clickIndex).findLast((event) => event.kind === 'state');
    if (
        playing?.state.status !== 'Playing' ||
        playing.state.play !== 'Pause' ||
        playing.state.active !== 'true' ||
        click.state.status !== 'Playing'
    ) {
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
    return inputs.length === order.length && stopped && inputs.at(-1)?.state.status === 'Stopped';
}

function parseEvent(text: string): TransportEvent {
    const value: unknown = JSON.parse(text);
    if (
        typeof value !== 'object' ||
        value === null ||
        !('at' in value) ||
        typeof value.at !== 'number' ||
        !('kind' in value) ||
        (value.kind !== 'state' && value.kind !== 'input') ||
        !('state' in value) ||
        typeof value.state !== 'object' ||
        value.state === null ||
        !('status' in value.state) ||
        typeof value.state.status !== 'string' ||
        !('play' in value.state) ||
        typeof value.state.play !== 'string' ||
        !('active' in value.state) ||
        typeof value.state.active !== 'string'
    ) {
        throw new Error('Malformed production transport observation');
    }
    const event: TransportEvent = {
        raw: text,
        at: value.at,
        kind: value.kind,
        state: { status: value.state.status, play: value.state.play, active: value.state.active },
    };
    if (value.kind === 'input') {
        if (
            !('phase' in value) ||
            typeof value.phase !== 'string' ||
            !('event' in value) ||
            typeof value.event !== 'string'
        )
            throw new Error('Missing native event phase');
        event.phase = value.phase;
        event.event = value.event;
        for (const key of [
            'trusted',
            'sameTarget',
            'visible',
            'enabled',
            'connected',
            'geometry',
            'hit',
            'point',
        ] as const) {
            const observed: unknown = Reflect.get(value, key);
            if (typeof observed !== 'boolean') throw new Error('Missing native event admission evidence');
            event[key] = observed;
        }
    }
    return event;
}

export async function admitProductionTransportInput(page: Page, app: FrameLocator) {
    const controls = app.getByRole('group', { name: 'Playback controls', exact: true });
    const stop = controls.getByRole('button', { name: 'Stop', exact: true });
    const count = await stop.count();
    if (count !== 1) assertTransportAdmission(count, false, false);
    assertTransportAdmission(count, await stop.isVisible(), await stop.isEnabled());
    await expect(stop).toHaveAttribute('data-testid', 'transport-stop');
    await expect(controls.getByRole('status')).toHaveText('Stopped');
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await stop.click({ trial: true, timeout: 5_000 });
    const box = await stop.boundingBox();
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
    )
        throw new Error('Production Stop has no in-viewport measured geometry');
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const marker = 'production-transport-input:';
    const events: TransportEvent[] = [];
    let changed: (() => void) | undefined;
    let observationFailure: unknown;
    const onConsole = (message: { text: () => string }) => {
        if (!message.text().startsWith(marker)) return;
        try {
            events.push(parseEvent(message.text().slice(marker.length)));
        } catch (error) {
            observationFailure = error;
        }
        changed?.();
    };
    page.on('console', onConsole);
    try {
        await stop.evaluate(
            (original, options) => {
                if (!(original instanceof HTMLButtonElement)) throw new Error('Production Stop is not a native button');
                const cluster = original.closest('[role="group"][aria-label="Playback controls"]');
                if (!cluster) throw new Error('Production Stop is outside Playback controls');
                const initial = original.getBoundingClientRect();
                const initialViewport = { width: innerWidth, height: innerHeight, x: scrollX, y: scrollY };
                function frameGeometry() {
                    const host = window.frameElement;
                    if (!host || !host.clientWidth || !host.clientHeight)
                        throw new Error('Shipping frame geometry is unavailable');
                    const rect = host.getBoundingClientRect();
                    return {
                        x: rect.x,
                        y: rect.y,
                        scaleX: rect.width / host.clientWidth,
                        scaleY: rect.height / host.clientHeight,
                    };
                }
                const initialFrame = frameGeometry();
                const center = {
                    x: initialFrame.x + (initial.x + initial.width / 2) * initialFrame.scaleX,
                    y: initialFrame.y + (initial.y + initial.height / 2) * initialFrame.scaleY,
                };
                if (
                    Math.abs(center.x - options.point.x) > 0.5 ||
                    Math.abs(center.y - options.point.y) > 0.5 ||
                    document
                        .elementFromPoint(initial.x + initial.width / 2, initial.y + initial.height / 2)
                        ?.closest('button') !== original
                )
                    throw new Error('Production Stop measured point is covered or mismatched');
                function state() {
                    const play = cluster!.querySelector('[data-testid="transport-play"]');
                    return {
                        status: cluster!.querySelector('[role="status"]')?.textContent?.trim() ?? '',
                        play: play?.getAttribute('aria-label') ?? '',
                        active: play?.getAttribute('data-active') ?? '',
                    };
                }
                function emit(event: Record<string, unknown>) {
                    console.info(
                        options.marker +
                            JSON.stringify({
                                at: Date.now(),
                                performanceNow: performance.now(),
                                state: state(),
                                ...event,
                            })
                    );
                }
                let lastState = '';
                function observeState() {
                    const next = JSON.stringify(state());
                    if (next === lastState) return;
                    lastState = next;
                    emit({ kind: 'state' });
                }
                for (const phase of ['capture', 'bubble']) {
                    for (const type of ['pointerdown', 'pointerup', 'click']) {
                        document.addEventListener(
                            type,
                            (event) => {
                                if (!(event instanceof MouseEvent)) return;
                                const rect = original.getBoundingClientRect();
                                const frame = frameGeometry();
                                const target = event.composedPath().find((node) => node instanceof HTMLButtonElement);
                                let visible = true;
                                for (let node: Element | null = original; node; node = node.parentElement) {
                                    const style = getComputedStyle(node);
                                    if (
                                        node.hasAttribute('hidden') ||
                                        node.hasAttribute('inert') ||
                                        node.getAttribute('aria-hidden') === 'true' ||
                                        style.display === 'none' ||
                                        style.visibility !== 'visible' ||
                                        Number(style.opacity) === 0
                                    )
                                        visible = false;
                                }
                                // The existing button press visual translates by one pixel; layout movement is refused.
                                const geometry =
                                    Math.abs(rect.x - initial.x) <= 0.5 &&
                                    Math.abs(rect.y - initial.y) <= 1.01 &&
                                    Math.abs(rect.width - initial.width) <= 0.5 &&
                                    Math.abs(rect.height - initial.height) <= 0.5 &&
                                    Math.abs(frame.x - initialFrame.x) <= 0.5 &&
                                    Math.abs(frame.y - initialFrame.y) <= 0.5 &&
                                    Math.abs(frame.scaleX - initialFrame.scaleX) < 0.0001 &&
                                    Math.abs(frame.scaleY - initialFrame.scaleY) < 0.0001 &&
                                    innerWidth === initialViewport.width &&
                                    innerHeight === initialViewport.height &&
                                    scrollX === initialViewport.x &&
                                    scrollY === initialViewport.y;
                                emit({
                                    kind: 'input',
                                    phase,
                                    event: type,
                                    trusted: event.isTrusted,
                                    sameTarget:
                                        target === original &&
                                        original.getAttribute('aria-label') === 'Stop' &&
                                        original.getAttribute('data-testid') === 'transport-stop',
                                    visible,
                                    enabled: !original.disabled,
                                    connected: original.isConnected,
                                    geometry,
                                    hit:
                                        document.elementFromPoint(event.clientX, event.clientY)?.closest('button') ===
                                        original,
                                    point:
                                        event.clientX >= rect.left &&
                                        event.clientX <= rect.right &&
                                        event.clientY >= rect.top &&
                                        event.clientY <= rect.bottom &&
                                        Math.abs(frame.x + event.clientX * frame.scaleX - options.point.x) <= 0.5 &&
                                        Math.abs(frame.y + event.clientY * frame.scaleY - options.point.y) <= 0.5,
                                    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                                    frameClientPoint: { x: event.clientX, y: event.clientY },
                                    mainPoint: options.point,
                                    currentTarget: event.currentTarget === document ? 'document' : 'other',
                                });
                            },
                            { capture: phase === 'capture', passive: true }
                        );
                    }
                }
                new MutationObserver(observeState).observe(cluster, {
                    subtree: true,
                    childList: true,
                    characterData: true,
                    attributes: true,
                    attributeFilter: ['aria-label', 'data-active'],
                });
                observeState();
            },
            { marker, point }
        );
    } catch (error) {
        page.off('console', onConsole);
        throw error;
    }
    const attempt = createSingleInputAttempt(() => page.mouse.click(point.x, point.y));
    return {
        snapshot: () => ({ box, point, events: [...events] }),
        dispose: () => page.off('console', onConsole),
        stop: async () => {
            const latest = events.findLast((event) => event.kind === 'state');
            if (observationFailure) throw observationFailure;
            if (latest?.state.status !== 'Playing' || latest.state.play !== 'Pause')
                throw new Error('Public Playing/Pause was not observed before native Stop');
            const startedAt = Date.now();
            await attempt();
            await withinBudget(
                new Promise<void>((resolve, reject) => {
                    changed = () => {
                        try {
                            if (observationFailure) throw observationFailure;
                            if (validateTransportStop(events, startedAt)) resolve();
                        } catch (error) {
                            reject(error);
                        }
                    };
                    changed();
                }),
                5_000
            );
            changed = undefined;
            await expect(controls.getByRole('status')).toHaveText('Stopped', { timeout: 5_000 });
            await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 5_000 });
            await expect(stop).toBeVisible({ timeout: 5_000 });
            await expect(app.getByTestId('transport-playhead')).toHaveText(/^Bars\s*27\s*\.\s*1\s*\.\s*000$/, {
                timeout: 5_000,
            });
        },
    };
}
