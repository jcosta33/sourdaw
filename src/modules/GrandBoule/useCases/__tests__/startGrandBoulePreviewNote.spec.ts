import { describe, it, expect, vi } from 'vitest';

import { type Store } from '#/infra/store/types';

import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';
import { createDisconnectedGrandBouleEngineHandle } from '../../repositories/grandBouleEngineHandle';
import { createDefaultGrandBouleState, type GrandBouleState } from '../../stores/grandBouleStore';
import { startGrandBoulePreviewNote } from '../startGrandBoulePreviewNote';

function storeWith(value: GrandBouleState | null): Store<GrandBouleState> {
    return { value } as Store<GrandBouleState>;
}

describe('startGrandBoulePreviewNote', () => {
    it('applies the same calibration and returns the exact acquired release', () => {
        const release = vi.fn();
        const start = vi.fn(() => release);
        const state = {
            ...createDefaultGrandBouleState(),
            midiCalibration: {
                ...createDefaultMidiCalibration(),
                velocityCurveExponent: 2,
                velocityFloor: 0.1,
                velocityCeiling: 0.9,
            },
        };
        const handle = { ...createDisconnectedGrandBouleEngineHandle(), startPreviewNote: start, isReady: () => true };
        expect(
            startGrandBoulePreviewNote({ engine: handle, store: storeWith(state), midiNote: 60, velocity: 0.5 })
        ).toBe(release);
        expect(start).toHaveBeenCalledWith({ midiNote: 60, velocity: expect.closeTo(0.3) });
    });

    it('does not start a disconnected preview', () => {
        const engine = createDisconnectedGrandBouleEngineHandle();
        expect(
            startGrandBoulePreviewNote({ engine, store: storeWith(null), midiNote: 60, velocity: 0.5 })
        ).toBeUndefined();
    });
});
