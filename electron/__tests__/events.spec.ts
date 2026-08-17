/**
 * The event path and its bounds (REQ-006).
 *
 * The properties worth proving are the ones that only show up under load or
 * during a crash: that a lagging progress producer coalesces instead of
 * queueing, that a stream refuses rather than dropping, and that neither one
 * grows without limit when the window it sends to is gone.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    COALESCED_EVENTS,
    createCommandStream,
    createEventForwarder,
    MAX_COALESCED_KEYS,
    STREAM_QUEUE_CAPACITY,
    type EventTarget,
} from '../events.js';

const CHANNEL = 'sourdaw:event';

type Sent = { readonly channel: string; readonly args: readonly unknown[] };

const recordingTarget = (): { target: EventTarget; sent: Sent[]; destroy: () => void } => {
    const sent: Sent[] = [];
    let destroyed = false;
    return {
        sent,
        destroy: () => {
            destroyed = true;
        },
        target: {
            isDestroyed: () => destroyed,
            send: (channel, ...args) => {
                sent.push({ channel, args });
            },
        },
    };
};

/** Flush on demand rather than on a clock, so nothing here waits on timing. */
const manualSchedule = (): { schedule: (flush: () => void) => void; run: () => void } => {
    let pending: (() => void) | undefined;
    return {
        schedule: (flush) => {
            pending = flush;
        },
        run: () => {
            const flush = pending;
            pending = undefined;
            flush?.();
        },
    };
};

describe('pushed events', () => {
    it('sends a non-progress event straight through, in order', () => {
        const { target, sent } = recordingTarget();
        const { schedule } = manualSchedule();
        const forwarder = createEventForwarder({ target: () => target, schedule, channel: CHANNEL });

        forwarder.emit('midi-message', { note: 60 });
        forwarder.emit('midi-message', { note: 62 });

        expect(sent).toEqual([
            { channel: CHANNEL, args: ['midi-message', { note: 60 }] },
            { channel: CHANNEL, args: ['midi-message', { note: 62 }] },
        ]);
    });

    it('drops an event when there is no window, rather than holding it', () => {
        // The addon's sink discards its result and a listener that has gone
        // away has never failed the operation that produced the event. Holding
        // MIDI messages through a renderer crash and then replaying them would
        // be worse than dropping them: the notes are stale by then.
        const { target, sent, destroy } = recordingTarget();
        const { schedule } = manualSchedule();
        const forwarder = createEventForwarder({ target: () => target, schedule, channel: CHANNEL });

        destroy();
        forwarder.emit('midi-message', { note: 60 });
        forwarder.flush();

        expect(sent).toEqual([]);
        expect(forwarder.pending()).toBe(0);
    });
});

describe('progress coalescing', () => {
    it('keeps only the newest value per analysis', () => {
        const { target, sent } = recordingTarget();
        const { schedule, run } = manualSchedule();
        const forwarder = createEventForwarder({ target: () => target, schedule, channel: CHANNEL });

        forwarder.emit('pitch-analysis-progress', { analysisId: 'a', progress: 0.1 });
        forwarder.emit('pitch-analysis-progress', { analysisId: 'a', progress: 0.4 });
        forwarder.emit('pitch-analysis-progress', { analysisId: 'a', progress: 0.9 });
        expect(sent).toEqual([]);
        run();

        expect(sent).toEqual([
            { channel: CHANNEL, args: ['pitch-analysis-progress', { analysisId: 'a', progress: 0.9 }] },
        ]);
    });

    it('does not let two concurrent analyses overwrite each other', () => {
        // Coalescing on the event name alone would make one analysis's bar
        // jump to the other's value and back.
        const { target, sent } = recordingTarget();
        const { schedule, run } = manualSchedule();
        const forwarder = createEventForwarder({ target: () => target, schedule, channel: CHANNEL });

        forwarder.emit('pitch-analysis-progress', { analysisId: 'a', progress: 0.2 });
        forwarder.emit('pitch-analysis-progress', { analysisId: 'b', progress: 0.5 });
        run();

        expect(sent.map((entry) => entry.args[1])).toEqual([
            { analysisId: 'a', progress: 0.2 },
            { analysisId: 'b', progress: 0.5 },
        ]);
    });

    it('holds at most one payload per key, and no more keys than its cap', () => {
        const { target, sent } = recordingTarget();
        const { schedule } = manualSchedule();
        const forwarder = createEventForwarder({ target: () => target, schedule, channel: CHANNEL });

        for (let index = 0; index < MAX_COALESCED_KEYS * 3; index += 1) {
            forwarder.emit('pitch-analysis-progress', { analysisId: `a${String(index)}`, progress: 0.5 });
        }

        expect(forwarder.pending()).toBeLessThanOrEqual(MAX_COALESCED_KEYS);
        // Nothing was lost: past the cap the forwarder stops accumulating and
        // sends instead, which is the bound doing its job rather than a drop.
        forwarder.flush();
        expect(sent.length).toBe(MAX_COALESCED_KEYS * 3);
    });

    it('names the events that coalesce', () => {
        expect([...COALESCED_EVENTS.keys()]).toEqual(['pitch-analysis-progress']);
    });
});

describe('a bounded command stream', () => {
    const stream = (target: () => EventTarget | undefined, capacity?: number) =>
        createCommandStream({ streamId: 's0', target, channel: 'sourdaw:stream', capacity });

    it('delivers in order and holds nothing while the window is there', () => {
        const { target, sent } = recordingTarget();
        const subject = stream(() => target);

        subject.emit({ sequence: 0 });
        subject.emit({ sequence: 1 });

        expect(subject.queued()).toBe(0);
        expect(sent.map((entry) => entry.args)).toEqual([
            ['s0', { sequence: 0 }],
            ['s0', { sequence: 1 }],
        ]);
    });

    it('queues while the window is gone and delivers in order once it is back', () => {
        let live = false;
        const { target, sent } = recordingTarget();
        const subject = stream(() => (live ? target : undefined));

        subject.emit({ sequence: 0 });
        subject.emit({ sequence: 1 });
        expect(subject.queued()).toBe(2);

        live = true;
        subject.emit({ sequence: 2 });

        expect(subject.queued()).toBe(0);
        expect(sent.map((entry) => entry.args[1])).toEqual([{ sequence: 0 }, { sequence: 1 }, { sequence: 2 }]);
    });

    it('fails the request at the cap instead of dropping an event', () => {
        const subject = stream(() => undefined, 4);

        for (let index = 0; index <= 4; index += 1) {
            subject.emit({ sequence: index });
        }

        expect(subject.failure()).toMatch(/exceeded its 4-event queue/u);
    });

    it('stays failed and stops holding anything once it has overflowed', () => {
        const subject = stream(() => undefined, 2);

        for (let index = 0; index < 100; index += 1) {
            subject.emit({ sequence: index });
        }

        expect(subject.failure()).toBeDefined();
        expect(subject.queued()).toBe(0);
    });

    it('defaults to the cap the renderer already refuses past', () => {
        expect(STREAM_QUEUE_CAPACITY).toBe(256);
    });

    it('ignores anything emitted after it closes', () => {
        const { target, sent } = recordingTarget();
        const subject = stream(() => target);

        subject.close();
        subject.emit({ sequence: 0 });

        expect(sent).toEqual([]);
    });

    it('fails the request when a send throws, rather than retrying or escaping', () => {
        // A `send` into a webContents that died between the liveness check and
        // the call throws. Letting that out would surface as an exception
        // inside the addon's threadsafe callback; retrying it would spin on the
        // head of the queue. The request fails, and the caller is told.
        const throwing: EventTarget = {
            isDestroyed: () => false,
            send: vi.fn(() => {
                throw new Error('render frame was disposed');
            }),
        };
        const subject = stream(() => throwing);

        expect(() => subject.emit({ sequence: 0 })).not.toThrow();
        expect(subject.failure()).toMatch(/could not be delivered/u);
        expect(subject.queued()).toBe(0);
    });
});
