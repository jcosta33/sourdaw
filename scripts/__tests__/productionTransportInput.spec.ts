import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    assertTransportAdmission,
    createSingleInputAttempt,
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
        expect(validateTransportStop(events, 10)).toBe(true);
        expect(validateTransportStop(events.slice(0, 2), 10)).toBe(false);
        expect(
            validateTransportStop(
                events.filter((event) => event.kind !== 'state' || event.state.status !== 'Stopped'),
                10
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
            expect(() => validateTransportStop(events, 10)).toThrow('untrusted, missing, moved, hidden, covered');
        }
    );

    it('does not admit an earlier Stop or an incomplete sequence as the current input', () => {
        expect(validateTransportStop(successfulEvents(), 100)).toBe(false);
        expect(() =>
            validateTransportStop(
                successfulEvents().filter((event) => event.phase !== 'bubble'),
                10
            )
        ).toThrow();
    });

    it('refuses reordered or duplicate native events', () => {
        const events = successfulEvents();
        const second = events[2];
        const third = events[3];
        if (!second || !third) {
            throw new Error('Missing controlled inputs for reorder');
        }
        [events[2], events[3]] = [third, second];
        expect(() => validateTransportStop(events, 10)).toThrow('out of order');
        const duplicate = successfulEvents();
        const firstInput = duplicate[2];
        if (!firstInput) {
            throw new Error('Missing controlled input');
        }
        duplicate.push(firstInput);
        expect(() => validateTransportStop(duplicate, 10)).toThrow('out of order');
    });

    it('refuses a click after public playback has already ended', () => {
        const events = successfulEvents();
        events.splice(2, 0, { at: 9, kind: 'state', state: stopped() });
        expect(() => validateTransportStop(events, 10)).toThrow('not preceded');
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
