import { describe, it, expect, vi, beforeEach } from 'vitest';

import { panicGrandBoule } from '../panicGrandBoule';
import { releaseGrandBouleNote } from '../releaseGrandBouleNote';
import { triggerGrandBouleNote } from '../triggerGrandBouleNote';

const mocks = vi.hoisted(() => {
    const storeValue = { value: { parameters: { velocityCurve: 1.0 } } };
    return {
        engine: {
            isReady: vi.fn(() => true),
            noteOn: vi.fn(),
            noteOff: vi.fn(),
            allNotesOff: vi.fn(),
        },
        grandBouleStoreValue: storeValue,
        grandBouleStore: {
            get value() {
                return storeValue.value;
            },
        },
    };
});

vi.mock('../../stores/grandBouleStore', () => ({
    grandBouleStore: mocks.grandBouleStore,
}));

describe('GrandBoule Use Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.grandBouleStoreValue.value = { parameters: { velocityCurve: 1.0 } } as any;
    });

    describe('triggerGrandBouleNote', () => {
        it('applies midi calibration curve and calls engine', () => {
            mocks.grandBouleStoreValue.value = {
                midiCalibration: { velocityFloor: 0, velocityCeiling: 1, velocityCurveExponent: 2.0 },
            } as any;

            triggerGrandBouleNote({
                engine: mocks.engine as any,
                store: mocks.grandBouleStoreValue as any,
                midiNote: 60,
                velocity: 0.5,
            });
            expect(mocks.engine.noteOn).toHaveBeenCalledWith({ midiNote: 60, velocity: 0.25 });
        });

        it('bails if engine not ready', () => {
            mocks.engine.isReady.mockReturnValue(false);
            triggerGrandBouleNote({
                engine: mocks.engine as any,
                store: mocks.grandBouleStoreValue as any,
                midiNote: 60,
                velocity: 1,
            });
            expect(mocks.engine.noteOn).not.toHaveBeenCalled();
        });
    });

    describe('releaseGrandBouleNote', () => {
        it('calls noteOff on engine', () => {
            mocks.engine.isReady.mockReturnValue(true);
            releaseGrandBouleNote({ engine: mocks.engine as any, midiNote: 60 });
            expect(mocks.engine.noteOff).toHaveBeenCalledWith({ midiNote: 60 });
        });
    });

    describe('panicGrandBoule', () => {
        it('calls allNotesOff on engine', () => {
            panicGrandBoule({ engine: mocks.engine as any });
            expect(mocks.engine.allNotesOff).toHaveBeenCalled();
        });
    });
});
