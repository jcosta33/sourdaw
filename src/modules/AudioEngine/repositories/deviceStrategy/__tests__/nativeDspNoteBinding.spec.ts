import { describe, it, expect, vi, beforeEach } from 'vitest';

import { NATIVE_DSP_DEVICE_FACTORIES } from '../nativeDspDeviceFactories';

// Which positional slot each device's own `noteOn` reads, and therefore which
// adapter the factory table must bind to it.
//
// The named request object (`DeviceNoteOnRequest`) removed the *dispatcher's*
// ability to misroute a note, but it did not make a wrong binding a compile
// error, and it is worth being precise about why. `bindMelodicNotes` constrains
// its argument to `(note, velocity, sampleFrame?, channel?) => void` and
// `bindPadNotes` to `(pad, velocity, midiNote?, sampleFrame?) => void`. Those
// two types are mutually assignable: same arity, every parameter
// `number | undefined`, and parameter names play no part in assignability. So
// `bindMelodicNotes(toaster)` and `bindPadNotes(levain)` both type-check, and
// either one reproduces exactly the frame/channel swap the named request was
// introduced to end.
//
// This spec is what actually holds the binding. It drives each note-voicing
// entry of the real factory table with a stub node that records positional
// arguments, and asserts the slots. Adding a fifth instrument with a third note
// API, or binding an existing one to the wrong adapter, fails here.

type Recorded = { method: 'noteOn' | 'noteOff'; args: (number | undefined)[] };

const recorded: Recorded[] = [];

/**
 * A node with the arity of every real engine node's note surface. It is
 * deliberately signature-agnostic — it records slots without naming them, so
 * the assertions below, not the stub, decide what each slot means.
 */
function makeRecordingNode() {
    return {
        workletNode: {} as AudioWorkletNode,
        ready: Promise.resolve({}),
        noteOn: (a: number, b: number, c?: number, d?: number) => {
            recorded.push({ method: 'noteOn', args: [a, b, c, d] });
        },
        noteOff: (a: number, b?: number, c?: number, d?: number) => {
            recorded.push({ method: 'noteOff', args: [a, b, c, d] });
        },
    };
}

// Only `create*` is replaced. Each module's real `is*Device` predicate is kept,
// so the device-type strings below are the production ones rather than a
// second, driftable copy.
vi.mock('../../../engine/FermenterNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/FermenterNode')>()),
    createFermenterNode: vi.fn(() => Promise.resolve(makeRecordingNode())),
}));
vi.mock('../../../engine/ToasterNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/ToasterNode')>()),
    createToasterNode: vi.fn(() => Promise.resolve(makeRecordingNode())),
}));
vi.mock('../../../engine/LevainNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/LevainNode')>()),
    createLevainNode: vi.fn(() => Promise.resolve(makeRecordingNode())),
}));
vi.mock('../../../engine/GrandBouleNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/GrandBouleNode')>()),
    createGrandBouleNode: vi.fn(() => Promise.resolve(makeRecordingNode())),
}));

async function buildNode(deviceType: string) {
    const factory = NATIVE_DSP_DEVICE_FACTORIES.find((candidate) => candidate.matches(deviceType));
    if (!factory) {
        throw new Error(`no factory claims ${deviceType}`);
    }
    return factory.create({} as BaseAudioContext);
}

describe('native DSP note bindings map the named request onto each device own note API', () => {
    beforeEach(() => {
        recorded.length = 0;
    });

    // Fermenter, Levain and Grand Boule all publish
    // `(note, velocity, sampleFrame?, channel?)`.
    it.each(['fermenter', 'levain', 'grand-boule'])(
        '%s receives the frame in slot 3 and the channel in slot 4',
        async (deviceType) => {
            const node = await buildNode(deviceType);

            node.noteOn?.({ noteOrPad: 60, velocity: 100, sampleFrame: 480, channel: 3 });
            node.noteOff?.({ noteOrPad: 60, sampleFrame: 960 });

            expect(recorded).toEqual([
                { method: 'noteOn', args: [60, 100, 480, 3] },
                { method: 'noteOff', args: [60, 960, undefined, undefined] },
            ]);
        }
    );

    // A melodic device must not be handed a pad request's `midiNote`: there is
    // no slot for it, and putting it in slot 3 is the original defect inverted.
    it.each(['fermenter', 'levain', 'grand-boule'])(
        '%s ignores midiNote rather than voicing it',
        async (deviceType) => {
            const node = await buildNode(deviceType);

            node.noteOn?.({ noteOrPad: 60, velocity: 100, midiNote: 38, sampleFrame: 480 });

            expect(recorded).toEqual([{ method: 'noteOn', args: [60, 100, 480, undefined] }]);
        }
    );

    // Toaster is pad-addressed: `(pad, velocity, midiNote?, sampleFrame?)`.
    it('toaster receives midiNote in slot 3 and the frame in slot 4', async () => {
        const node = await buildNode('toaster');

        node.noteOn?.({ noteOrPad: 4, velocity: 100, midiNote: 38, sampleFrame: 480 });
        node.noteOff?.({ noteOrPad: 4, sampleFrame: 960 });

        expect(recorded).toEqual([
            { method: 'noteOn', args: [4, 100, 38, 480] },
            { method: 'noteOff', args: [4, 960, undefined, undefined] },
        ]);
    });

    // Both halves or neither. A binding that adapted `noteOn` and left `noteOff`
    // positional would still satisfy `NativeDspNode` — `noteOff` is optional
    // there — and would release notes at the wrong frame while note-ons looked
    // correct, which is the harder half of this defect to hear.
    //
    // This says nothing about the seven table entries that voice no notes.
    // Their `create` fetches wasm and cannot run here, and they are not
    // note-less at the strategy in any case — see the note on the instrument
    // gate in the PR description.
    it.each(['fermenter', 'toaster', 'levain', 'grand-boule'])(
        '%s binds both halves of its note surface',
        async (deviceType) => {
            const node = await buildNode(deviceType);

            expect(node.noteOn).toBeTypeOf('function');
            expect(node.noteOff).toBeTypeOf('function');
        }
    );
});
