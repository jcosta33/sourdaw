import { describe, it, expect, vi } from 'vitest';

import {
    asAudioNode,
    asBaseAudioContext,
    createMockAudioContext,
} from '../../../../helpers/__tests__/audioContext.mock';
import { type DrumKit, scheduleKitNote } from '../drumKitSynth';
import { getSynthParamsFromDevices } from '../getSynthParamsFromDevices';
import { scheduleNote } from '../scheduleNote';

const KICK_PARAMS = getSynthParamsFromDevices([]);

vi.mock('../scheduleNote', () => ({
    scheduleNote: vi.fn(() => null),
}));

describe('drumKitSynth types', () => {
    it('DrumKit type is structurally compatible with the engine model', () => {
        const kit: DrumKit = {
            id: 'test',
            name: 'Test Kit',
            voices: [
                {
                    name: 'Kick',
                    pitchRange: [36, 36],
                    params: {} as never,
                },
            ],
        };

        expect(kit.voices).toHaveLength(1);
        expect(kit.voices[0]!.pitchRange).toEqual([36, 36]);
    });
});

describe('scheduleKitNote', () => {
    it('scales the voice peak by the kit gain on top of the clip gain', () => {
        const ctx = createMockAudioContext();
        const context = asBaseAudioContext(ctx);
        const destination = asAudioNode(ctx.destination);
        const kit: DrumKit = {
            id: 'kit',
            name: 'Kit',
            voices: [{ name: 'Kick', pitchRange: [36, 36], params: KICK_PARAMS }],
        };

        scheduleKitNote(context, destination, kit, 36, 1, 0.2, 100, 0.5, 0.6);

        // The clip-gain argument is the linear multiplier of the voice's peak level.
        expect(scheduleNote).toHaveBeenCalledExactlyOnceWith(
            context,
            destination,
            36,
            1,
            0.2,
            100,
            KICK_PARAMS,
            undefined,
            0.3
        );
    });
});
