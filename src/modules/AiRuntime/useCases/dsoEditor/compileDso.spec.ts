import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { compileDsoExecutionDependencies, executeDsos } from './compileDso';

describe('compileDso executeDsos injectable', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('runs with injectDependencies and an empty DSO list (smoke)', async () => {
        const mocks = {
            executeAppAction: vi.fn(),
            addTrack: vi.fn(),
            removeTrack: vi.fn(),
            addClip: vi.fn(),
            addDevice: vi.fn(),
            setLoopRegion: vi.fn(),
            disableLooping: vi.fn(),
            applyMelodyToTrack: vi.fn(),
            applyChordProgressionToTrack: vi.fn(),
            applyDrumPatternToTrack: vi.fn(),
            humanizeNotes: vi.fn(),
            setSend: vi.fn(),
            trackStore: compileDsoExecutionDependencies.trackStore,
            transportStore: compileDsoExecutionDependencies.transportStore,
            midiStore: compileDsoExecutionDependencies.midiStore,
        };
        injectDependencies(executeDsos, mocks);
        const summaries = await executeDsos([]);
        expect(summaries).toEqual([]);
    });
});
