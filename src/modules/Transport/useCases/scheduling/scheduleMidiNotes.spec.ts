import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { scheduleMidiNotes } from './scheduleMidiNotes';
import { defaultTransportState } from '../../models/TransportState';

describe('scheduleMidiNotes', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not schedule synth when MIDI store is uninitialized', async () => {
        const getSynthParamsForTrack = vi.fn();
        injectDependencies(scheduleMidiNotes, {
            trackStore: { value: { tracks: [] } },
            midiStore: { value: null },
            tempoMapStore: { value: { changes: [] } },
            getTempoAtBeat: vi.fn(() => 120),
            resolveClipsWithComping: vi.fn(() => []),
            resolveDrumKit: vi.fn(() => null),
            resolveDrumKitDef: vi.fn(() => null),
            scheduleFrozenTrack: vi.fn(() => false),
            getYeastRack: vi.fn(() => ({ getProcessorIds: () => [], processBlock: vi.fn() })),
            getYeastWorkletNodeAsync: vi.fn(),
            getAudioContext: vi.fn(() => ({ sampleRate: 48000 }) as AudioContext),
            getChordAtBeat: vi.fn(),
            transposeForChordTrack: vi.fn((p) => p),
            getSynthParamsForTrack,
            getCompensationDelay: vi.fn(() => 0),
            ensureTrackStrip: vi.fn(),
            getCurrentTime: vi.fn(() => 0),
            scheduleDrumKitNote: vi.fn(),
            scheduleKitNote: vi.fn(),
            scheduleFaustNote: vi.fn(),
            scheduleNote: vi.fn(),
        });

        await scheduleMidiNotes(0, 4, 0, 0, [], defaultTransportState, 120);

        expect(getSynthParamsForTrack).not.toHaveBeenCalled();
    });
});
