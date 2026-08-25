import { describe, it, expect, vi } from 'vitest';

import {
    createGrandBouleFrameQueue,
    receiveGrandBouleMessage,
    type GrandBouleDispatchMsg,
} from '../grandBouleEngineCore';

/**
 * The behaviour both Grand Boule hosts inherit rather than implement.
 *
 * `grandBouleDispatchParity.spec.ts` proves the Worker and the offline processor
 * both route through this module; these are the properties that then hold for
 * both. Asserted here because neither host can exercise them cleanly on its own —
 * the Worker's producer loop is capped at `TARGET_AHEAD` frames ahead of a read
 * head nothing advances in a test, so it cannot be driven far enough to observe
 * what a panic dropped.
 */

type EngineCall = { method: string; args: readonly unknown[] };

type RecordingInstance = {
    calls: EngineCall[];
    instance: Parameters<typeof receiveGrandBouleMessage>[0]['instance'];
};

function createRecordingInstance(): RecordingInstance {
    const calls: EngineCall[] = [];
    const record =
        (method: string) =>
        (...args: unknown[]): void => {
            calls.push({ method, args });
        };
    const instance = {
        note_on: record('note_on'),
        note_on_with_channel: record('note_on_with_channel'),
        note_off: record('note_off'),
        note_off_on_channel: record('note_off_on_channel'),
        note_expression: record('note_expression'),
        set_param: record('set_param'),
        set_sustain: record('set_sustain'),
        set_una_corda: record('set_una_corda'),
        set_sostenuto: record('set_sostenuto'),
        note_on_midi2: record('note_on_midi2'),
        set_temperament: record('set_temperament'),
        load_attack_clip: record('load_attack_clip'),
        all_notes_off: record('all_notes_off'),
        process: vi.fn(() => 0),
        get_right_ptr: vi.fn(() => 0),
    };
    return { calls, instance: instance as unknown as Parameters<typeof receiveGrandBouleMessage>[0]['instance'] };
}

function receive(
    instance: Parameters<typeof receiveGrandBouleMessage>[0]['instance'],
    queue: ReturnType<typeof createGrandBouleFrameQueue>,
    msg: GrandBouleDispatchMsg,
    blockEndFrame: number | null
): void {
    receiveGrandBouleMessage({ instance, queue, msg, blockEndFrame });
}

describe('an unrecognised message', () => {
    it('is ignored, not raised', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // `createWebAudioEngine` already broadcasts `{type:'shutdown'}` to every
        // device worklet, and `post` is untyped at the sender, so an unknown
        // `type` can reach here. The offline processor catches whatever this
        // throws, sets `_faulted`, and then returns early from `process()` for
        // the rest of the render — its `{type:'error'}` reply arrives after
        // `ready` has settled and is dropped as 'late'. One stray message would
        // silently produce exactly the silent export this transport exists to
        // eliminate. The old worker's switch had no `default` and ignored
        // unknowns; that is the behaviour to keep at runtime. The `never` arm is
        // still there, and it is what fails the build.
        const unknown = { type: 'shutdown' } as unknown as GrandBouleDispatchMsg;
        expect(() => receive(instance, queue, unknown, 128)).not.toThrow();
        expect(calls).toEqual([]);
    });
});

describe('the Grand Boule frame queue', () => {
    it('drops pending notes when the device panics', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 5_000 }, 128);
        const queuedBeforePanic = queue.size();

        receive(instance, queue, { type: 'allNotesOff' }, 128);
        queue.drain(instance, 10_000);

        // Without the clear, the look-ahead window keeps arriving after the user
        // asked for silence: note 60 would voice on the next drain, seconds after
        // the panic.
        expect({ queuedBeforePanic, queuedAfterPanic: queue.size(), calls }).toEqual({
            queuedBeforePanic: 1,
            queuedAfterPanic: 0,
            calls: [{ method: 'all_notes_off', args: [] }],
        });
    });

    it('preserves a scheduled parameter when panic discards pending notes', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, { type: 'param', name: 'toneColor', value: 0.3, sampleFrame: 500 }, 128);
        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 500 }, 128);
        receive(instance, queue, { type: 'allNotesOff' }, 128);
        queue.drain(instance, 1_000);

        expect(calls).toEqual([
            { method: 'all_notes_off', args: [] },
            { method: 'set_param', args: ['tone_color', 0.3] },
        ]);
    });

    it('holds a framed parameter until the block containing its frame', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, { type: 'param', name: 'masterGain', value: 0.7, sampleFrame: 128 }, 128);
        expect(calls).toEqual([]);

        queue.drain(instance, 256);
        expect(calls).toEqual([{ method: 'set_param', args: ['master_gain', 0.7] }]);
    });

    it('places a frame sitting exactly on a block boundary in that block, not the one before', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // Block 0 ends at frame 128, exclusive. Frame 128 belongs to block 1.
        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 128 }, 128);
        const voicedInBlock0 = calls.length;

        queue.drain(instance, 256);

        expect({ voicedInBlock0, voicedByBlock1: calls.length }).toEqual({ voicedInBlock0: 0, voicedByBlock1: 1 });
    });

    it('voices a note whose frame the engine has already passed instead of holding it', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // A note that arrives late sounds late. Holding it would silently drop
        // every note of a part scheduled behind the render cursor.
        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 10 }, 1_280);

        expect({ calls, queued: queue.size() }).toEqual({
            calls: [{ method: 'note_on_with_channel', args: [60, 1, 0] }],
            queued: 0,
        });
    });

    it('keeps an expression behind the note-on it shares a frame with', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 500 }, 128);
        receive(
            instance,
            queue,
            {
                type: 'noteExpression',
                midiNote: 60,
                channel: 0,
                bendSemitones: 2,
                pressure: 0,
                slide: 0,
                sampleFrame: 500,
            },
            128
        );
        queue.drain(instance, 1_000);

        // The voice has to exist before it is bent; an unstable insert would bend
        // a voice that is not there yet and drop the bend.
        expect(calls.map(({ method }) => method)).toEqual(['note_on_with_channel', 'note_expression']);
    });

    it('voices immediately when the host cannot place a frame yet', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // `null` is the Worker before its ring is mapped. Queueing there would
        // strand the message against a clock that never arrives.
        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 9_999 }, null);

        expect({ calls, queued: queue.size() }).toEqual({
            calls: [{ method: 'note_on_with_channel', args: [60, 1, 0] }],
            queued: 0,
        });
    });

    it('voices a note whose frame is not a usable number', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: Number.NaN }, 128);

        // `NaN >= blockEnd` is false and `NaN < blockEnd` is false, so a frame
        // check that forgot to test finiteness would queue this forever.
        expect({ calls, queued: queue.size() }).toEqual({
            calls: [{ method: 'note_on_with_channel', args: [60, 1, 0] }],
            queued: 0,
        });
    });
});
