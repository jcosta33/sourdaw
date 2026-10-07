import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NATIVE_DSP_DEVICE_FACTORIES } from '../nativeDspDeviceFactories';
import { NativeDspDeviceStrategy } from '../NativeDspDeviceStrategy';

// Which engine call a stored controller reaches on each instrument that honours
// one, and that every other instrument offers no controller surface at all. As
// with the note bindings, every parameter here is `number | undefined`, so the
// compiler cannot tell a pedal bound to the wrong engine method; this spec drives
// the real factory table against a recording node and asserts the call and slot.

const recorded: string[] = [];

function makeRecordingNode() {
    return {
        workletNode: {} as AudioWorkletNode,
        ready: Promise.resolve({}),
        noteOn: vi.fn(),
        noteOff: vi.fn(),
        setSustain: (position: number, sampleFrame?: number) => recorded.push(`setSustain ${position} @${sampleFrame}`),
        setSostenuto: (engaged: boolean, sampleFrame?: number) =>
            recorded.push(`setSostenuto ${engaged} @${sampleFrame}`),
        setUnaCorda: (engaged: boolean, sampleFrame?: number) =>
            recorded.push(`setUnaCorda ${engaged} @${sampleFrame}`),
        handleCc: (cc: number, value: number, sampleFrame?: number) =>
            recorded.push(`handleCc ${cc} ${value} @${sampleFrame}`),
    };
}

vi.mock('../../../engine/LevainNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/LevainNode')>()),
    createLevainNode: vi.fn(() => Promise.resolve(makeRecordingNode())),
}));
vi.mock('../../../engine/GrandBouleNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/GrandBouleNode')>()),
    createGrandBouleNode: vi.fn(() => Promise.resolve(makeRecordingNode())),
}));
vi.mock('../../../engine/FermenterNode', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/FermenterNode')>()),
    createFermenterNode: vi.fn(() => Promise.resolve(makeRecordingNode())),
}));

async function buildStrategy(deviceType: string): Promise<NativeDspDeviceStrategy> {
    const factory = NATIVE_DSP_DEVICE_FACTORIES.find((candidate) => candidate.matches(deviceType));
    if (!factory) {
        throw new Error(`no factory claims ${deviceType}`);
    }
    return new NativeDspDeviceStrategy(await factory.create({} as BaseAudioContext));
}

describe('native DSP stored controller bindings', () => {
    beforeEach(() => {
        recorded.length = 0;
    });

    it('maps Grand Boule pedals onto its sustain position and its two latches, at the frame', async () => {
        const strategy = await buildStrategy('grand-boule');

        strategy.controlChange?.({ controller: 64, value: 127, sampleFrame: 100 });
        strategy.controlChange?.({ controller: 64, value: 0, sampleFrame: 200 });
        strategy.controlChange?.({ controller: 66, value: 64, sampleFrame: 300 });
        strategy.controlChange?.({ controller: 66, value: 63, sampleFrame: 400 });
        strategy.controlChange?.({ controller: 67, value: 127, sampleFrame: 500 });

        expect(recorded).toEqual([
            'setSustain 1 @100',
            'setSustain 0 @200',
            'setSostenuto true @300',
            'setSostenuto false @400',
            'setUnaCorda true @500',
        ]);
    });

    it('ignores a Grand Boule controller that is not a pedal', async () => {
        const strategy = await buildStrategy('grand-boule');

        strategy.controlChange?.({ controller: 1, value: 90, sampleFrame: 100 });

        expect(recorded).toEqual([]);
    });

    it('hands Levain the raw controller byte and the frame', async () => {
        const strategy = await buildStrategy('levain');

        strategy.controlChange?.({ controller: 1, value: 64, sampleFrame: 100 });

        expect(recorded).toEqual(['handleCc 1 64 @100']);
    });

    it('offers no controller surface on an instrument that does not honour one', async () => {
        const strategy = await buildStrategy('fermenter');

        expect(strategy.controlChange).toBeUndefined();
    });
});
