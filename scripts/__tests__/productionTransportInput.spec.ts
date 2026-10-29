import { runInNewContext } from 'node:vm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    assertTransportAdmission,
    createSingleInputAttempt,
    installProductionTransportCapture,
    observeProductionTransportState,
    parseProductionTransportEvent,
    validateTransportStop,
} from '../../tests/production-e2e/productionTransportInput';

function stopped() {
    return { status: 'Stopped', play: 'Play', active: 'false' };
}
function playing() {
    return { status: 'Playing', play: 'Pause', active: 'true' };
}
function successfulEvents(): Parameters<typeof validateTransportStop>[0] {
    const events: Parameters<typeof validateTransportStop>[0] = [
        { at: 1, kind: 'state', state: stopped() },
        { at: 2, kind: 'state', state: playing() },
    ];
    for (const [index, [event, phase]] of [
        ['pointerdown', 'capture'],
        ['pointerdown', 'bubble'],
        ['pointerup', 'capture'],
        ['pointerup', 'bubble'],
        ['click', 'capture'],
        ['click', 'bubble'],
    ].entries()) {
        if (phase === 'bubble' && event === 'click') {
            events.push({ at: 20, kind: 'state', state: stopped() });
        }
        events.push({
            at: 10 + index * 2,
            kind: 'input',
            event,
            phase,
            state: phase === 'bubble' && event === 'click' ? stopped() : playing(),
            trusted: true,
            sameTarget: true,
            visible: true,
            enabled: true,
            connected: true,
            geometry: true,
            hit: true,
            point: true,
        });
    }
    return events;
}

afterEach(() => vi.useRealTimers());

describe('production public Stop admission', () => {
    it.each([
        [0, false, false],
        [2, true, true],
        [1, false, true],
        [1, true, false],
    ])('refuses missing, ambiguous, hidden or disabled entries (%s)', (count, visible, enabled) => {
        expect(() => assertTransportAdmission(count, visible, enabled)).toThrow('before Play');
    });

    it('accepts only the observed unique actionable entry', () => {
        expect(() => assertTransportAdmission(1, true, true)).not.toThrow();
    });
});

describe('native input evidence rather than API invocation', () => {
    it('requires ordered trusted target delivery and a later public state transition', () => {
        const events = successfulEvents();
        expect(validateTransportStop(events, { observedEventCount: 2 })).toBe(true);
        expect(validateTransportStop(events.slice(0, 2), { observedEventCount: 2 })).toBe(false);
        expect(
            validateTransportStop(
                events.filter((event) => event.kind !== 'state' || event.state.status !== 'Stopped'),
                { observedEventCount: 1 }
            )
        ).toBe(false);
    });

    it.each(['trusted', 'sameTarget', 'visible', 'enabled', 'connected', 'geometry', 'hit', 'point'] as const)(
        'refuses actual input with failed %s evidence',
        (field) => {
            const events = successfulEvents();
            const click = events.find((event) => event.event === 'click' && event.phase === 'capture');
            if (!click) {
                throw new Error('Missing controlled click');
            }
            click[field] = false;
            expect(() => validateTransportStop(events, { observedEventCount: 2 })).toThrow(
                'untrusted, missing, moved, hidden, covered'
            );
        }
    );

    it('does not admit an earlier Stop or an incomplete sequence as the current input', () => {
        expect(validateTransportStop(successfulEvents(), { observedEventCount: successfulEvents().length })).toBe(
            false
        );
        expect(() =>
            validateTransportStop(
                successfulEvents().filter((event) => event.phase !== 'bubble'),
                { observedEventCount: 2 }
            )
        ).toThrow();
    });

    it.each([-1000, 9000, 10000, 11000])(
        'accepts ordered current input when diagnostic wall time is %s',
        (inputTime) => {
            const events = successfulEvents();
            for (const [index, event] of events.entries()) {
                event.at = index < 2 ? 10000 + index : inputTime + index - 2;
            }
            expect(validateTransportStop(events, { observedEventCount: 2 })).toBe(true);
        }
    );

    it('rejects a complete prior attempt and does not mix its input with a partial new attempt', () => {
        const events = successfulEvents();
        expect(validateTransportStop(events, { observedEventCount: events.length })).toBe(false);
        events.push({ at: 1, kind: 'state', state: playing() });
        const boundary = { observedEventCount: events.length };
        const priorInput = events[2];
        if (!priorInput) {
            throw new Error('Missing controlled input');
        }
        events.push(priorInput);
        expect(validateTransportStop(events, boundary)).toBe(false);
    });

    it.each([-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 100])(
        'refuses malformed journal boundary %s',
        (count) => {
            expect(() => validateTransportStop(successfulEvents(), { observedEventCount: count })).toThrow('boundary');
        }
    );

    it('cannot borrow pre-boundary pointer-down events to complete a partial old attempt', () => {
        const events = successfulEvents();
        expect(() => validateTransportStop(events, { observedEventCount: 4 })).toThrow('out of order');
    });

    it('requires public Playing at the send boundary, even if a later state would admit the click', () => {
        const events = successfulEvents();
        events.splice(2, 0, { at: 3, kind: 'state', state: stopped() }, { at: 4, kind: 'state', state: playing() });
        expect(() => validateTransportStop(events, { observedEventCount: 3 })).toThrow('boundary');
    });

    it('refuses reordered or duplicate native events', () => {
        const events = successfulEvents();
        const second = events[2];
        const third = events[3];
        if (!second || !third) {
            throw new Error('Missing controlled inputs for reorder');
        }
        [events[2], events[3]] = [third, second];
        expect(() => validateTransportStop(events, { observedEventCount: 2 })).toThrow('out of order');
        const duplicate = successfulEvents();
        const firstInput = duplicate[2];
        if (!firstInput) {
            throw new Error('Missing controlled input');
        }
        duplicate.push(firstInput);
        expect(() => validateTransportStop(duplicate, { observedEventCount: 2 })).toThrow('out of order');
    });

    it('refuses a click after public playback has already ended', () => {
        const events = successfulEvents();
        events.splice(2, 0, { at: 9, kind: 'state', state: stopped() });
        expect(() => validateTransportStop(events, { observedEventCount: 2 })).toThrow('not preceded');
    });
});

describe('single native attempt and bounded wait', () => {
    it('never sends a second input after a completed attempt', async () => {
        const send = vi.fn(() => Promise.resolve());
        const attempt = createSingleInputAttempt(send);
        await attempt();
        await expect(attempt()).rejects.toThrow('second native input');
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('reports a pending deadline and forbids a second send without pretending to cancel', async () => {
        vi.useFakeTimers();
        let complete: () => void = () => undefined;
        const send = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    complete = resolve;
                })
        );
        const attempt = createSingleInputAttempt(send, 50);
        const failure = expect(attempt()).rejects.toThrow('pending input is not cancelled');
        await vi.advanceTimersByTimeAsync(50);
        await failure;
        await expect(attempt()).rejects.toThrow('second native input');
        complete();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 5001])(
        'refuses an invalid or expanded budget %s before dispatch',
        (budget) => {
            const send = vi.fn(() => Promise.resolve());
            expect(() => createSingleInputAttempt(send, budget)).toThrow('budget');
            expect(send).not.toHaveBeenCalled();
        }
    );
});

function capturedGeometry() {
    return {
        rect: { x: 553, y: 53, width: 24, height: 24 },
        frame: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
        viewport: { x: 0, y: 0, width: 1280, height: 720 },
    };
}

function capturedInput() {
    return {
        at: 1,
        kind: 'input',
        phase: 'capture',
        event: 'click',
        state: playing(),
        trusted: true,
        sameTarget: true,
        visible: true,
        enabled: true,
        connected: true,
        hit: true,
        initialGeometry: capturedGeometry(),
        currentGeometry: capturedGeometry(),
        frameClientPoint: { x: 565, y: 65 },
        mainPoint: { x: 565, y: 65 },
    };
}

function validateCapturedClick(value: unknown): boolean {
    const events = successfulEvents();
    const index = events.findIndex((event) => event.event === 'click' && event.phase === 'capture');
    events[index] = parseProductionTransportEvent(JSON.stringify(value));
    return validateTransportStop(events, { observedEventCount: 2 });
}

describe('event-time geometry facts validated in Node', () => {
    it('permits the existing one-pixel press visual and the original half-pixel horizontal tolerance', () => {
        const value = capturedInput();
        value.currentGeometry.rect.y++;
        value.currentGeometry.rect.x += 0.5;
        expect(parseProductionTransportEvent(JSON.stringify(value))).toMatchObject({ geometry: true, point: true });
        expect(validateCapturedClick(value)).toBe(true);
    });

    it.each([
        [
            'horizontal layout',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.rect.x += 0.51;
            },
        ],
        [
            'vertical layout',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.rect.y += 1.02;
            },
        ],
        [
            'width',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.rect.width += 0.51;
            },
        ],
        [
            'height',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.rect.height += 0.51;
            },
        ],
        [
            'frame x',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.frame.x += 0.51;
            },
        ],
        [
            'frame y',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.frame.y += 0.51;
            },
        ],
        [
            'frame scale x',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.frame.scaleX += 0.0001001;
            },
        ],
        [
            'frame scale y',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.frame.scaleY += 0.0001001;
            },
        ],
        [
            'viewport width',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.viewport.width++;
            },
        ],
        [
            'viewport height',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.viewport.height++;
            },
        ],
        [
            'scroll x',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.viewport.x++;
            },
        ],
        [
            'scroll y',
            (value: ReturnType<typeof capturedInput>) => {
                value.currentGeometry.viewport.y++;
            },
        ],
    ] as const)('refuses changed %s facts rather than trusting a browser geometry flag', (_name, change) => {
        const value = capturedInput();
        change(value);
        expect(parseProductionTransportEvent(JSON.stringify(value)).geometry).toBe(false);
        expect(() => validateCapturedClick(value)).toThrow('moved, hidden, covered');
    });

    it('maps frame client coordinates into main-page coordinates and refuses a coordinate-space mix', () => {
        const value = capturedInput();
        for (const geometry of [value.initialGeometry, value.currentGeometry]) {
            geometry.frame = { x: 10, y: 20, scaleX: 2, scaleY: 2 };
        }
        value.mainPoint = { x: 1140, y: 150 };
        expect(validateCapturedClick(value)).toBe(true);
        value.mainPoint = value.frameClientPoint;
        expect(parseProductionTransportEvent(JSON.stringify(value)).point).toBe(false);
        expect(() => validateCapturedClick(value)).toThrow('moved, hidden, covered');
    });

    it('requires the actual input point to remain inside the current Stop rect', () => {
        const value = capturedInput();
        value.frameClientPoint.x = value.currentGeometry.rect.x - 1;
        value.mainPoint.x = value.frameClientPoint.x;
        expect(parseProductionTransportEvent(JSON.stringify(value)).point).toBe(false);
        expect(() => validateCapturedClick(value)).toThrow('moved, hidden, covered');
    });

    it.each(['trusted', 'sameTarget', 'visible', 'enabled', 'connected', 'hit'] as const)(
        'retains failed %s capture evidence through parsing and sequence validation',
        (field) => {
            const value = capturedInput();
            value[field] = false;
            expect(() => validateCapturedClick(value)).toThrow('moved, hidden, covered');
        }
    );

    it.each([
        null,
        [],
        { ...capturedInput(), state: null },
        { ...capturedInput(), state: { status: 'Playing', play: 'Pause', active: true } },
        { ...capturedInput(), kind: 'unknown' },
        { ...capturedInput(), trusted: 'true' },
        { ...capturedInput(), currentGeometry: null },
        { ...capturedInput(), frameClientPoint: { x: '565', y: 65 } },
        { ...capturedInput(), at: Number.POSITIVE_INFINITY },
    ])('refuses malformed raw observation %#', (value) => {
        expect(() => parseProductionTransportEvent(JSON.stringify(value))).toThrow();
    });

    it('refuses missing or non-finite geometry members before they can satisfy input evidence', () => {
        const missing = capturedInput();
        Reflect.deleteProperty(missing.currentGeometry.frame, 'scaleX');
        expect(() => validateCapturedClick(missing)).toThrow();
        const overflow = JSON.stringify(capturedInput()).replace('"width":24', '"width":1e400');
        expect(() => parseProductionTransportEvent(overflow)).toThrow('geometry');
    });
});

function serializedCapturePlatform() {
    const messages: string[] = [];
    const status = { textContent: 'Stopped' };
    const play = {
        label: 'Play',
        active: 'false',
        getAttribute(name: string) {
            return name === 'aria-label' ? this.label : this.active;
        },
    };
    const controls = { querySelector: (selector: string) => (selector === '[role="status"]' ? status : play) };
    class CaptureButton {
        parentElement: CaptureButton | null = null;
        disabled = false;
        isConnected = true;
        rect = capturedGeometry().rect;
        attributes = new Map([
            ['aria-label', 'Stop'],
            ['data-testid', 'transport-stop'],
        ]);
        style = { display: 'block', visibility: 'visible', opacity: '1' };
        closest(selector: string) {
            return selector === 'button' ? this : controls;
        }
        hasAttribute(name: string) {
            return this.attributes.has(name);
        }
        getAttribute(name: string) {
            return this.attributes.get(name) ?? null;
        }
        getBoundingClientRect() {
            return this.rect;
        }
    }
    const button = new CaptureButton();
    let covered = false;
    const listeners: Array<{
        type: string;
        callback: (event: CaptureMouseEvent) => void;
        options: { capture: boolean; passive: boolean };
    }> = [];
    const document = {
        elementFromPoint: () => (covered ? null : button),
        addEventListener(
            type: string,
            callback: (event: CaptureMouseEvent) => void,
            options: { capture: boolean; passive: boolean }
        ) {
            listeners.push({ type, callback, options });
        },
    };
    class CaptureMouseEvent {
        isTrusted = false;
        clientX = 565;
        clientY = 65;
        currentTarget = document;
        target = button;
        composedPath() {
            return [this.target];
        }
    }
    let stateChanged = () => undefined;
    let observerCount = 0;
    class CaptureMutationObserver {
        constructor(callback: () => undefined) {
            stateChanged = callback;
        }
        observe() {
            observerCount++;
        }
    }
    const host = {
        clientWidth: 1280,
        clientHeight: 720,
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 1280, height: 720 }),
    };
    const sandbox: Record<string, unknown> = {
        button,
        document,
        window: { frameElement: host },
        HTMLButtonElement: CaptureButton,
        MouseEvent: CaptureMouseEvent,
        MutationObserver: CaptureMutationObserver,
        innerWidth: 1280,
        innerHeight: 720,
        scrollX: 0,
        scrollY: 0,
        getComputedStyle: (node: CaptureButton) => node.style,
        console: { info: (message: string) => messages.push(message) },
        performance: { now: () => 1 },
        Date: { now: () => 10000 },
        options: { marker: 'capture:' },
    };
    const admission: unknown = runInNewContext(
        `(${observeProductionTransportState.toString()})(button, options)`,
        sandbox
    );
    if (typeof admission !== 'object' || admission === null || !('geometry' in admission)) {
        throw new Error('Missing serialized admission');
    }
    sandbox.options = { marker: 'capture:', initialGeometry: admission.geometry, point: { x: 565, y: 65 } };
    runInNewContext(`(${installProductionTransportCapture.toString()})(button, options)`, sandbox);
    const fire = (event = new CaptureMouseEvent()) => {
        const listener = listeners.find((entry) => entry.type === 'pointerdown' && entry.options.capture);
        if (!listener) {
            throw new Error('Missing serialized listener');
        }
        listener.callback(event);
        const raw = messages.at(-1);
        if (!raw) {
            throw new Error('Missing serialized capture');
        }
        return parseProductionTransportEvent(raw.slice('capture:'.length));
    };
    return {
        button,
        CaptureButton,
        CaptureMouseEvent,
        listeners,
        messages,
        status,
        play,
        stateChanged,
        observerCount,
        fire,
        cover: () => {
            covered = true;
        },
    };
}

describe('serialized browser entries without Node module closures', () => {
    it('captures a different original target and a covered hit as separate failed facts', () => {
        const platform = serializedCapturePlatform();
        const event = new platform.CaptureMouseEvent();
        event.target = new platform.CaptureButton();
        expect(platform.fire(event)).toMatchObject({ sameTarget: false, hit: true });
        platform.cover();
        expect(platform.fire()).toMatchObject({ sameTarget: true, hit: false });
    });

    it('captures passive raw event-time facts and public state in an independent realm', () => {
        const platform = serializedCapturePlatform();
        expect(platform.listeners).toHaveLength(6);
        expect(platform.listeners.every((listener) => listener.options.passive)).toBe(true);
        expect(platform.observerCount).toBe(1);
        platform.status.textContent = 'Playing';
        platform.play.label = 'Pause';
        platform.play.active = 'true';
        platform.stateChanged();
        expect(parseProductionTransportEvent(platform.messages[1]?.slice('capture:'.length) ?? '')).toMatchObject({
            kind: 'state',
            state: playing(),
        });
        platform.button.rect.y++;
        expect(platform.fire()).toMatchObject({
            trusted: false,
            sameTarget: true,
            visible: true,
            enabled: true,
            connected: true,
            geometry: true,
            hit: true,
            point: true,
            state: playing(),
        });
    });

    it.each(['hidden', 'inert', 'aria-hidden', 'display', 'visibility', 'opacity'])(
        'captures the original ancestor %s visibility refusal',
        (condition) => {
            const platform = serializedCapturePlatform();
            const ancestor = new platform.CaptureButton();
            platform.button.parentElement = ancestor;
            if (condition === 'display') {
                ancestor.style.display = 'none';
            } else if (condition === 'visibility') {
                ancestor.style.visibility = 'hidden';
            } else if (condition === 'opacity') {
                ancestor.style.opacity = '0';
            } else {
                ancestor.attributes.set(condition, condition === 'aria-hidden' ? 'true' : '');
            }
            expect(platform.fire().visible).toBe(false);
        }
    );
});
