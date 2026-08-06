import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Container } from '#/infra/di/Container';

import { createGrandBouleStore, resetGrandBouleStores, defaultGrandBouleState } from '../../../stores/grandBouleStore';
import { setGrandBouleEventBus } from '../../../useCases/grandBouleEventBus';
import { GrandBoulePanel } from '../GrandBoulePanel';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

/**
 * The panel resolves a fresh engine handle every render. A calibrated store
 * outlives any one engine instance (`storesByDevice` is a module Map), so a
 * device node that comes up after the user has calibrated must be told what
 * the readout already says. This spec replaces the resolver so the "engine is
 * ready" edge can be driven without a worklet.
 */
const setParam = vi.fn<(input: { name: string; value: number }) => void>();
let engineIsReady = false;

const noop = (): void => {};

vi.mock('../../../useCases/resolveGrandBouleEngine', () => ({
    resolveGrandBouleEngine: () => ({
        noteOn: noop,
        noteOnMidi2: noop,
        noteOff: noop,
        setParam,
        setSustain: noop,
        setUnaCorda: noop,
        setSostenuto: noop,
        setTemperament: noop,
        loadAttackClip: noop,
        allNotesOff: noop,
        isReady: () => engineIsReady,
        getAnalyserNode: () => null,
        sampleRate: () => 48_000,
    }),
}));

const mockEventBus = {
    emit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => {}),
};

/** The `setParam` payloads the engine received, keyed by parameter name. */
function dispatchedParams(): Record<string, number> {
    const byName: Record<string, number> = {};
    for (const [payload] of setParam.mock.calls) {
        byName[payload.name] = payload.value;
    }
    return byName;
}

describe('GrandBoulePanel MIDI calibration engine sync', () => {
    beforeEach(() => {
        Container.clear();
        setGrandBouleEventBus(mockEventBus);
        resetGrandBouleStores();
        vi.clearAllMocks();
        engineIsReady = false;
    });

    it('pushes the stored calibration to an engine that has just come up', () => {
        const deviceId = 'calib-sync-A';
        const store = createGrandBouleStore(deviceId);
        // 0.42 and 30 ms — neither is a default (0.15 / 5 ms), so the engine
        // cannot look calibrated by having never been told anything.
        store.set({
            ...defaultGrandBouleState,
            midiCalibration: {
                ...defaultGrandBouleState.midiCalibration,
                sustainThreshold: 0.42,
                ccSmoothingMs: 30,
            },
        });
        engineIsReady = true;

        render(<GrandBoulePanel deviceId={deviceId} />);

        expect(dispatchedParams().sustain_threshold).toBe(0.42);
        expect(dispatchedParams().cc_smoothing_ms).toBe(30);
    });

    it('pushes a different calibration for a differently calibrated device', () => {
        const deviceId = 'calib-sync-B';
        const store = createGrandBouleStore(deviceId);
        store.set({
            ...defaultGrandBouleState,
            midiCalibration: {
                ...defaultGrandBouleState.midiCalibration,
                sustainThreshold: 0.08,
                ccSmoothingMs: 45,
            },
        });
        engineIsReady = true;

        render(<GrandBoulePanel deviceId={deviceId} />);

        expect(dispatchedParams().sustain_threshold).toBe(0.08);
        expect(dispatchedParams().cc_smoothing_ms).toBe(45);
    });

    it('sends no calibration while the engine is still loading', () => {
        const deviceId = 'calib-sync-C';
        const store = createGrandBouleStore(deviceId);
        store.set({
            ...defaultGrandBouleState,
            midiCalibration: {
                ...defaultGrandBouleState.midiCalibration,
                sustainThreshold: 0.42,
                ccSmoothingMs: 30,
            },
        });
        engineIsReady = false;

        render(<GrandBoulePanel deviceId={deviceId} />);

        expect(dispatchedParams()).not.toHaveProperty('sustain_threshold');
        expect(dispatchedParams()).not.toHaveProperty('cc_smoothing_ms');
    });
});
