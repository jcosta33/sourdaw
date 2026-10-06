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
    /** Make the next `refusals` pushes answer `false`, as a full block list does. */
    refuseNextPushes: (refusals: number) => void;
    instance: Parameters<typeof receiveGrandBouleMessage>[0]['instance'];
};

function createRecordingInstance(): RecordingInstance {
    const calls: EngineCall[] = [];
    let refusals = 0;
    const record =
        (method: string) =>
        (...args: unknown[]): void => {
            calls.push({ method, args });
        };
    const recordPush =
        (method: string) =>
        (...args: unknown[]): boolean => {
            if (refusals > 0) {
                refusals--;
                return false;
            }
            calls.push({ method, args });
            return true;
        };
    const instance = {
        push_note_on: recordPush('push_note_on'),
        push_note_off: recordPush('push_note_off'),
        push_note_off_on_channel: recordPush('push_note_off_on_channel'),
        push_note_expression: recordPush('push_note_expression'),
        set_param: record('set_param'),
        push_sustain: recordPush('push_sustain'),
        push_una_corda: recordPush('push_una_corda'),
        push_sostenuto: recordPush('push_sostenuto'),
        note_on_midi2: record('note_on_midi2'),
        set_temperament: record('set_temperament'),
        all_notes_off: record('all_notes_off'),
        process: vi.fn(() => 0),
        get_right_ptr: vi.fn(() => 0),
    };
    return {
        calls,
        refuseNextPushes(count) {
            refusals = count;
        },
        instance: instance as unknown as Parameters<typeof receiveGrandBouleMessage>[0]['instance'],
    };
}

function receive(
    instance: Parameters<typeof receiveGrandBouleMessage>[0]['instance'],
    queue: ReturnType<typeof createGrandBouleFrameQueue>,
    msg: GrandBouleDispatchMsg,
    block: { startFrame: number; endFrame: number } | null
): void {
    receiveGrandBouleMessage({ instance, queue, msg, block });
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
        expect(() => receive(instance, queue, unknown, { startFrame: 0, endFrame: 128 })).not.toThrow();
        expect(calls).toEqual([]);
    });
});

describe('the Grand Boule frame queue', () => {
    it('drops pending notes when the device panics', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(
            instance,
            queue,
            { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 5_000 },
            {
                startFrame: 0,
                endFrame: 128,
            }
        );
        const queuedBeforePanic = queue.size();

        receive(instance, queue, { type: 'allNotesOff' }, { startFrame: 0, endFrame: 128 });
        queue.drain(instance, 9_872, 10_000);

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
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, { type: 'param', name: 'toneColor', value: 0.3, sampleFrame: 500 }, block);
        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 500 }, block);
        receive(instance, queue, { type: 'allNotesOff' }, block);
        queue.drain(instance, 384, 512);

        expect(calls).toEqual([
            { method: 'all_notes_off', args: [] },
            { method: 'set_param', args: ['tone_color', 0.3] },
        ]);
    });

    it('keeps what a panic retained ahead of a move stamped from a clock that stepped back', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        queue.enqueue({ type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 1_900 });
        queue.enqueue({ type: 'sustain', position: 1, sampleFrame: 2_000 });
        queue.enqueue({ type: 'param', name: 'toneColor', value: 0.3, sampleFrame: 2_100 });
        queue.discardNotes();

        // The flush restarts the block clock lower than the stamps the kept
        // messages carry; a later move is stamped from that lower clock.
        queue.capPendingFrames(1_000);
        queue.enqueue({ type: 'sustain', position: 0, sampleFrame: 1_000 });
        queue.drain(instance, 896, 2_304);

        // The parameter keeps its own frame (2 100, offset 1 204) and so applies
        // after both pedal moves, which sit at the capped frame.
        expect(calls).toEqual([
            { method: 'push_sustain', args: [1, 104] },
            { method: 'push_sustain', args: [0, 104] },
            { method: 'set_param', args: ['tone_color', 0.3] },
        ]);
    });

    it('keeps a framed parameter queued beyond the block at its own frame through a flush cap', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, { type: 'param', name: 'toneColor', value: 0.3, sampleFrame: 2_000 }, block);
        receive(instance, queue, { type: 'allNotesOff' }, block);
        queue.capPendingFrames(1_000);

        queue.drain(instance, 896, 1_024);
        expect(calls.filter((call) => call.method === 'set_param')).toEqual([]);

        queue.drain(instance, 1_920, 2_048);
        expect(calls.filter((call) => call.method === 'set_param')).toEqual([
            { method: 'set_param', args: ['tone_color', 0.3] },
        ]);
    });

    it('holds a framed parameter until the block containing its frame', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(
            instance,
            queue,
            { type: 'param', name: 'masterGain', value: 0.7, sampleFrame: 128 },
            {
                startFrame: 0,
                endFrame: 128,
            }
        );
        expect(calls).toEqual([]);

        queue.drain(instance, 128, 256);
        expect(calls).toEqual([{ method: 'set_param', args: ['master_gain', 0.7] }]);
    });

    it('applies a frameless parameter on arrival, leaving nothing queued', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, { type: 'param', name: 'masterGain', value: 0.6 }, { startFrame: 256, endFrame: 384 });

        expect({ calls, queued: queue.size() }).toEqual({
            calls: [{ method: 'set_param', args: ['master_gain', 0.6] }],
            queued: 0,
        });
    });

    it('applies a parameter framed inside the arriving block on arrival, and a non-finite frame likewise', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 256, endFrame: 384 };

        receive(instance, queue, { type: 'param', name: 'masterGain', value: 0.6, sampleFrame: 300 }, block);
        receive(instance, queue, { type: 'param', name: 'toneColor', value: 0.2, sampleFrame: 10 }, block);
        receive(instance, queue, { type: 'param', name: 'lidPosition', value: 0.9, sampleFrame: Number.NaN }, block);

        expect({ calls, queued: queue.size() }).toEqual({
            calls: [
                { method: 'set_param', args: ['master_gain', 0.6] },
                { method: 'set_param', args: ['tone_color', 0.2] },
                { method: 'set_param', args: ['lid_position', 0.9] },
            ],
            queued: 0,
        });
    });

    it('applies a parameter at the head of its block rather than at its frame', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // A parameter belongs to the whole block: the engine snaps or smooths it
        // once per `process` either way, so there is no offset to carry. Only
        // notes take the offset-queued path.
        receive(
            instance,
            queue,
            { type: 'param', name: 'toneColor', value: 0.25, sampleFrame: 500 },
            {
                startFrame: 0,
                endFrame: 128,
            }
        );
        queue.drain(instance, 384, 512);

        expect(calls).toEqual([{ method: 'set_param', args: ['tone_color', 0.25] }]);
    });

    it('places a frame sitting exactly on a block boundary in that block, not the one before', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // Block 0 ends at frame 128, exclusive. Frame 128 belongs to block 1.
        receive(
            instance,
            queue,
            { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 128 },
            {
                startFrame: 0,
                endFrame: 128,
            }
        );
        const voicedInBlock0 = calls.length;

        queue.drain(instance, 128, 256);

        expect({ voicedInBlock0, calls }).toEqual({
            voicedInBlock0: 0,
            calls: [{ method: 'push_note_on', args: [60, 1, 0, 0] }],
        });
    });

    it('drains a note at its own sample offset inside the block', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // Frame 500 sits 116 samples into the block that starts at 384. Voicing
        // it at the head would move the onset 2.6 ms early at 44.1 kHz and put
        // the worklet render off the native one.
        receive(
            instance,
            queue,
            { type: 'noteOn', midiNote: 60, velocity: 0.5, sampleFrame: 500 },
            {
                startFrame: 0,
                endFrame: 128,
            }
        );
        queue.drain(instance, 384, 512);

        expect(calls).toEqual([{ method: 'push_note_on', args: [60, 0.5, 0, 116] }]);
    });

    it('voices a note whose frame the engine has already passed at the head of the next drain instead of holding it', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // A note that arrives late sounds late. Holding it would silently drop
        // every note of a part scheduled behind the render cursor.
        receive(
            instance,
            queue,
            { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 10 },
            {
                startFrame: 1_152,
                endFrame: 1_280,
            }
        );
        const onArrival = { calls: [...calls], queued: queue.size() };
        queue.drain(instance, 1_152, 1_280);

        expect({ onArrival, calls, queued: queue.size() }).toEqual({
            onArrival: { calls: [], queued: 1 },
            calls: [{ method: 'push_note_on', args: [60, 1, 0, 0] }],
            queued: 0,
        });
    });

    it('keeps an expression behind the note-on it shares a frame with', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 500 }, block);
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
            block
        );
        queue.drain(instance, 384, 512);

        // The voice has to exist before it is bent; an unstable insert would bend
        // a voice that is not there yet and drop the bend. Both carry the same
        // offset, and the engine applies events in push order, so the bend lands
        // on the sample the note starts on.
        expect(calls).toEqual([
            { method: 'push_note_on', args: [60, 1, 0, 116] },
            { method: 'push_note_expression', args: [60, 0, 2, 0, 0, 116] },
        ]);
    });

    it('holds a refused note and everything behind it for the next block', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 400 }, block);
        receive(instance, queue, { type: 'noteOn', midiNote: 64, velocity: 1, sampleFrame: 420 }, block);

        // The engine's block event list is full: the first push answers `false`.
        // Draining past it would sound note 64 before note 60.
        refuseNextPushes(1);
        queue.drain(instance, 384, 512);
        const afterRefusal = { calls: [...calls], queued: queue.size() };

        queue.drain(instance, 512, 640);

        expect({ afterRefusal, calls, queued: queue.size() }).toEqual({
            afterRefusal: { calls: [], queued: 2 },
            calls: [
                { method: 'push_note_on', args: [60, 1, 0, 0] },
                { method: 'push_note_on', args: [64, 1, 0, 0] },
            ],
            queued: 0,
        });
    });

    it('voices immediately when the host cannot place a frame yet', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // `null` is the Worker before its ring is mapped. Queueing there would
        // strand the message against a clock that never arrives.
        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 9_999 }, null);

        expect({ calls, queued: queue.size() }).toEqual({
            calls: [{ method: 'push_note_on', args: [60, 1, 0, 0] }],
            queued: 0,
        });
    });

    it('voices a note whose frame is not a usable number', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(
            instance,
            queue,
            { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: Number.NaN },
            {
                startFrame: 0,
                endFrame: 128,
            }
        );

        // `NaN >= blockEnd` is false and `NaN < blockEnd` is false, so a frame
        // check that forgot to test finiteness would queue this forever.
        queue.drain(instance, 0, 128);

        expect({ calls, queued: queue.size() }).toEqual({
            calls: [{ method: 'push_note_on', args: [60, 1, 0, 0] }],
            queued: 0,
        });
    });

    it('holds a note the engine refuses at its drain instead of dropping it', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // Inside the block about to render, and the list is full. The message
        // has to survive as a queued one, or the note is lost with no error
        // anywhere.
        receive(
            instance,
            queue,
            { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 100 },
            {
                startFrame: 0,
                endFrame: 128,
            }
        );
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        const afterRefusal = { calls: [...calls], queued: queue.size() };

        queue.drain(instance, 128, 256);

        expect({ afterRefusal, calls, queued: queue.size() }).toEqual({
            afterRefusal: { calls: [], queued: 1 },
            calls: [{ method: 'push_note_on', args: [60, 1, 0, 0] }],
            queued: 0,
        });
    });
});

describe('a Grand Boule pedal message', () => {
    it('is queued on arrival and pushed at its own offset when its frame lies inside the block about to render', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(
            instance,
            queue,
            { type: 'sustain', position: 1, sampleFrame: 1_200 },
            { startFrame: 1_152, endFrame: 1_280 }
        );
        const onArrival = { calls: [...calls], queued: queue.size() };
        queue.drain(instance, 1_152, 1_280);

        expect({ onArrival, calls, queued: queue.size() }).toEqual({
            onArrival: { calls: [], queued: 1 },
            calls: [{ method: 'push_sustain', args: [1, 48] }],
            queued: 0,
        });
    });

    it('is queued when its frame lies past the block and delivered at its offset in the block that holds it', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, { type: 'sustain', position: 0, sampleFrame: 500 }, { startFrame: 0, endFrame: 128 });
        const queuedAtArrival = { calls: [...calls], queued: queue.size() };

        queue.drain(instance, 384, 512);

        expect({ queuedAtArrival, calls, queued: queue.size() }).toEqual({
            queuedAtArrival: { calls: [], queued: 1 },
            calls: [{ method: 'push_sustain', args: [0, 116] }],
            queued: 0,
        });
    });

    it('is pushed at offset 0 when its frame is behind the block or it carries no frame', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 1_152, endFrame: 1_280 };

        receive(instance, queue, { type: 'sustain', position: 0.5, sampleFrame: 10 }, block);
        receive(instance, queue, { type: 'sostenuto', engaged: true }, block);
        queue.drain(instance, 1_152, 1_280);

        expect({ calls, queued: queue.size() }).toEqual({
            calls: [
                { method: 'push_sustain', args: [0.5, 0] },
                { method: 'push_sostenuto', args: [true, 0] },
            ],
            queued: 0,
        });
    });

    it('lets a frameless move of the same pedal replace a late framed one still waiting', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 1_152, endFrame: 1_280 };

        receive(instance, queue, { type: 'sustain', position: 0.5, sampleFrame: 10 }, block);
        receive(instance, queue, { type: 'sustain', position: 0.25 }, block);
        queue.drain(instance, 1_152, 1_280);

        expect(calls).toEqual([{ method: 'push_sustain', args: [0.25, 0] }]);
    });

    it('places sostenuto and una corda like a note, in order with the notes around them', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 500 }, block);
        receive(instance, queue, { type: 'sostenuto', engaged: true, sampleFrame: 500 }, block);
        receive(instance, queue, { type: 'unaCorda', engaged: true, sampleFrame: 500 }, block);
        receive(instance, queue, { type: 'noteOff', midiNote: 60, sampleFrame: 501 }, block);
        queue.drain(instance, 384, 512);

        expect(calls).toEqual([
            { method: 'push_note_on', args: [60, 1, 0, 116] },
            { method: 'push_sostenuto', args: [true, 116] },
            { method: 'push_una_corda', args: [true, 116] },
            { method: 'push_note_off', args: [60, 117] },
        ]);
    });

    it('is held with everything behind it for the next block when the engine refuses it', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, { type: 'sustain', position: 1, sampleFrame: 100 }, block);
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        const afterRefusal = { calls: [...calls], queued: queue.size() };

        queue.drain(instance, 128, 256);

        expect({ afterRefusal, calls, queued: queue.size() }).toEqual({
            afterRefusal: { calls: [], queued: 1 },
            calls: [{ method: 'push_sustain', args: [1, 0] }],
            queued: 0,
        });
    });

    it('is held for the next block when it carries no frame and the engine refuses it', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, { type: 'sustain', position: 0 }, { startFrame: 0, endFrame: 128 });
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        const afterRefusal = { calls: [...calls], queued: queue.size() };

        queue.drain(instance, 128, 256);

        expect({ afterRefusal, calls, queued: queue.size() }).toEqual({
            afterRefusal: { calls: [], queued: 1 },
            calls: [{ method: 'push_sustain', args: [0, 0] }],
            queued: 0,
        });
    });

    it('is held for the next block when its frame is unusable and the engine refuses it', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(
            instance,
            queue,
            { type: 'sustain', position: 1, sampleFrame: Number.NaN },
            { startFrame: 0, endFrame: 128 }
        );
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        const afterRefusal = { calls: [...calls], queued: queue.size() };
        queue.drain(instance, 128, 256);

        expect({ afterRefusal, calls, queued: queue.size() }).toEqual({
            afterRefusal: { calls: [], queued: 1 },
            calls: [{ method: 'push_sustain', args: [1, 0] }],
            queued: 0,
        });
    });

    it('delivers refused frameless sostenuto and una corda on the next block in arrival order', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, { type: 'sostenuto', engaged: true }, block);
        receive(instance, queue, { type: 'unaCorda', engaged: true }, block);
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        const afterRefusal = { calls: [...calls], queued: queue.size() };

        queue.drain(instance, 128, 256);

        expect({ afterRefusal, calls, queued: queue.size() }).toEqual({
            afterRefusal: { calls: [], queued: 2 },
            calls: [
                { method: 'push_sostenuto', args: [true, 0] },
                { method: 'push_una_corda', args: [true, 0] },
            ],
            queued: 0,
        });
    });

    it('survives a panic that discards the pending notes', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 500 }, block);
        receive(instance, queue, { type: 'sustain', position: 0, sampleFrame: 500 }, block);
        receive(instance, queue, { type: 'allNotesOff' }, block);
        queue.drain(instance, 384, 512);

        // The engine keeps its pedal state through a panic, so a queued pedal-up
        // is state the player already performed; dropping it with the notes
        // would leave the pedal down.
        expect(calls).toEqual([
            { method: 'all_notes_off', args: [] },
            { method: 'push_sustain', args: [0, 116] },
        ]);
    });

    it('lets a frameless lift outrank a queued press of the same pedal through a panic', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 1_152, endFrame: 1_280 };

        // The panic path of a device: all notes off, then the frameless pedal reset.
        // A live press queued at the block end must not drain after the lift.
        receive(instance, queue, { type: 'sustain', position: 1, sampleFrame: 1_280 }, block);
        receive(instance, queue, { type: 'allNotesOff' }, block);
        receive(instance, queue, { type: 'sustain', position: 0 }, block);
        queue.drain(instance, 1_280, 1_408);

        expect(calls.filter((call) => call.method === 'push_sustain')).toEqual([
            { method: 'push_sustain', args: [0, 0] },
        ]);
    });

    it('leaves a queued move of a different pedal when a frameless pedal move arrives', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 1_152, endFrame: 1_280 };

        receive(instance, queue, { type: 'sostenuto', engaged: true, sampleFrame: 1_280 }, block);
        receive(instance, queue, { type: 'sustain', position: 0 }, block);
        queue.drain(instance, 1_280, 1_408);

        expect(calls).toEqual([
            { method: 'push_sustain', args: [0, 0] },
            { method: 'push_sostenuto', args: [true, 0] },
        ]);
    });

    it('drains refused messages in arrival order whether or not they carry a frame', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, { type: 'sustain', position: 1 }, block);
        receive(instance, queue, { type: 'sustain', position: 0, sampleFrame: 60 }, block);
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        queue.drain(instance, 128, 256);

        expect(calls).toEqual([
            { method: 'push_sustain', args: [1, 0] },
            { method: 'push_sustain', args: [0, 0] },
        ]);
    });

    it('drains a refused frameless pedal ahead of a note queued for the next block', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 128 }, block);
        receive(instance, queue, { type: 'sostenuto', engaged: true }, block);
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        queue.drain(instance, 128, 256);

        expect(calls).toEqual([
            { method: 'push_sostenuto', args: [true, 0] },
            { method: 'push_note_on', args: [60, 1, 0, 0] },
        ]);
    });

    it('holds a refused frameless note for the next block instead of dropping it', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, { type: 'noteOff', midiNote: 60 }, { startFrame: 0, endFrame: 128 });
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        const afterRefusal = { calls: [...calls], queued: queue.size() };

        queue.drain(instance, 128, 256);

        expect({ afterRefusal, calls, queued: queue.size() }).toEqual({
            afterRefusal: { calls: [], queued: 1 },
            calls: [{ method: 'push_note_off', args: [60, 0] }],
            queued: 0,
        });
    });
});

describe('the order Grand Boule control messages reach the engine', () => {
    type PedalCase = {
        name: string;
        press: GrandBouleDispatchMsg;
        lift: GrandBouleDispatchMsg;
        framedPress: (sampleFrame: number) => GrandBouleDispatchMsg;
        framedLift: (sampleFrame: number) => GrandBouleDispatchMsg;
        method: string;
        engaged: unknown;
        disengaged: unknown;
    };

    const pedals: PedalCase[] = [
        {
            name: 'sustain',
            press: { type: 'sustain', position: 1 },
            lift: { type: 'sustain', position: 0 },
            framedPress: (sampleFrame) => ({ type: 'sustain', position: 1, sampleFrame }),
            framedLift: (sampleFrame) => ({ type: 'sustain', position: 0, sampleFrame }),
            method: 'push_sustain',
            engaged: 1,
            disengaged: 0,
        },
        {
            name: 'sostenuto',
            press: { type: 'sostenuto', engaged: true },
            lift: { type: 'sostenuto', engaged: false },
            framedPress: (sampleFrame) => ({ type: 'sostenuto', engaged: true, sampleFrame }),
            framedLift: (sampleFrame) => ({ type: 'sostenuto', engaged: false, sampleFrame }),
            method: 'push_sostenuto',
            engaged: true,
            disengaged: false,
        },
        {
            name: 'una corda',
            press: { type: 'unaCorda', engaged: true },
            lift: { type: 'unaCorda', engaged: false },
            framedPress: (sampleFrame) => ({ type: 'unaCorda', engaged: true, sampleFrame }),
            framedLift: (sampleFrame) => ({ type: 'unaCorda', engaged: false, sampleFrame }),
            method: 'push_una_corda',
            engaged: true,
            disengaged: false,
        },
    ];

    it.each(pedals)('delivers a refused $name press before the lift that follows it', (pedal) => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, pedal.framedPress(100), { startFrame: 0, endFrame: 128 });
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        receive(instance, queue, pedal.framedLift(140), { startFrame: 128, endFrame: 256 });
        queue.drain(instance, 128, 256);

        expect(calls).toEqual([
            { method: pedal.method, args: [pedal.engaged, 0] },
            { method: pedal.method, args: [pedal.disengaged, 12] },
        ]);
    });

    it('delivers a message the engine refused before a note queued for a later frame', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(
            instance,
            queue,
            { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 128 },
            { startFrame: 0, endFrame: 128 }
        );
        receive(
            instance,
            queue,
            { type: 'sostenuto', engaged: true, sampleFrame: 100 },
            { startFrame: 0, endFrame: 128 }
        );
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        queue.drain(instance, 128, 256);

        expect(calls).toEqual([
            { method: 'push_sostenuto', args: [true, 0] },
            { method: 'push_note_on', args: [60, 1, 0, 0] },
        ]);
    });

    it.each(pedals)('keeps a queued $name press from outliving a panic and a frameless lift', (pedal) => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        receive(instance, queue, pedal.framedPress(128), block);
        receive(instance, queue, { type: 'allNotesOff' }, block);
        receive(instance, queue, pedal.lift, block);
        queue.drain(instance, 128, 256);

        expect(calls.filter((call) => call.method === pedal.method)).toEqual([
            { method: pedal.method, args: [pedal.disengaged, 0] },
        ]);
    });

    it('delivers a refused note-off before a frameless pedal move that arrives in the next block', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        receive(instance, queue, { type: 'noteOff', midiNote: 60, sampleFrame: 50 }, { startFrame: 0, endFrame: 128 });
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        receive(instance, queue, { type: 'sustain', position: 1 }, { startFrame: 128, endFrame: 256 });
        queue.drain(instance, 128, 256);

        expect(calls).toEqual([
            { method: 'push_note_off', args: [60, 0] },
            { method: 'push_sustain', args: [1, 0] },
        ]);
    });

    it('pushes a frameless pedal move at the block head, ahead of notes queued at later frames', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        // A frameless move sits at the block's first frame, so frame order puts
        // it ahead of a note that arrived before it but sounds 20 samples in.
        receive(instance, queue, { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 20 }, block);
        receive(instance, queue, { type: 'sustain', position: 1 }, block);
        receive(instance, queue, { type: 'noteOff', midiNote: 60, sampleFrame: 90 }, block);
        queue.drain(instance, 0, 128);

        expect(calls).toEqual([
            { method: 'push_sustain', args: [1, 0] },
            { method: 'push_note_on', args: [60, 1, 0, 20] },
            { method: 'push_note_off', args: [60, 90] },
        ]);
    });

    it('does not push a queued note-off ahead of a late pedal that arrives after an unrelated message', () => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // The note-off sits at offset 100 of the block that renders next. An
        // arrival-time drain would push it on the param's arrival, and the
        // engine's forward-only cursor would then apply the late pedal after
        // it: the note released with the pedal up.
        receive(
            instance,
            queue,
            { type: 'noteOff', midiNote: 60, sampleFrame: 1_252 },
            { startFrame: 1_024, endFrame: 1_152 }
        );
        const block = { startFrame: 1_152, endFrame: 1_280 };
        receive(instance, queue, { type: 'param', name: 'masterGain', value: 0.5 }, block);
        receive(instance, queue, { type: 'sustain', position: 1, sampleFrame: 900 }, block);
        queue.drain(instance, 1_152, 1_280);

        expect(calls.filter((call) => call.method.startsWith('push_'))).toEqual([
            { method: 'push_sustain', args: [1, 0] },
            { method: 'push_note_off', args: [60, 100] },
        ]);
    });

    it('queues a late framed move at the block start, behind an older refused frameless one', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 1_000, endFrame: 1_128 };

        // The late release at frame 360 queued at its own frame would sort ahead
        // of the frameless press the engine refused first, and the pedal would
        // end down although the release arrived last.
        receive(instance, queue, { type: 'sustain', position: 1 }, block);
        receive(instance, queue, { type: 'sustain', position: 0, sampleFrame: 360 }, block);
        refuseNextPushes(1);
        queue.drain(instance, 1_000, 1_128);
        queue.drain(instance, 1_128, 1_256);

        expect(calls.filter((call) => call.method === 'push_sustain')).toEqual([
            { method: 'push_sustain', args: [1, 0] },
            { method: 'push_sustain', args: [0, 0] },
        ]);
    });

    it.each(pedals)('keeps a queued $name release through a panic', (pedal) => {
        const { calls, instance } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();
        const block = { startFrame: 0, endFrame: 128 };

        // The engine keeps every pedal's state through a panic, so a pedal move
        // the player already performed must survive it whichever pedal it is.
        receive(instance, queue, pedal.framedLift(200), block);
        receive(instance, queue, { type: 'allNotesOff' }, block);
        queue.drain(instance, 128, 256);

        expect(calls.filter((call) => call.method === pedal.method)).toEqual([
            { method: pedal.method, args: [pedal.disengaged, 72] },
        ]);
    });

    it('delivers two framed messages in order when the engine refuses the first', () => {
        const { calls, instance, refuseNextPushes } = createRecordingInstance();
        const queue = createGrandBouleFrameQueue();

        // The block list stays full for the first drain, so both stay queued.
        receive(
            instance,
            queue,
            { type: 'noteOn', midiNote: 60, velocity: 1, sampleFrame: 10 },
            { startFrame: 0, endFrame: 128 }
        );
        receive(
            instance,
            queue,
            { type: 'noteOn', midiNote: 64, velocity: 1, sampleFrame: 20 },
            { startFrame: 0, endFrame: 128 }
        );
        refuseNextPushes(1);
        queue.drain(instance, 0, 128);
        const afterRefusal = { calls: [...calls], queued: queue.size() };
        queue.drain(instance, 128, 256);

        expect({ afterRefusal, calls }).toEqual({
            afterRefusal: { calls: [], queued: 2 },
            calls: [
                { method: 'push_note_on', args: [60, 1, 0, 0] },
                { method: 'push_note_on', args: [64, 1, 0, 0] },
            ],
        });
    });
});
