import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { audioToMidi, detectKey } from './audioAnalysis';

describe('detectKey', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not call summarizeFeatures when the clip has no audio buffer', async () => {
        const summarizeFeatures = vi.fn();
        injectDependencies(detectKey, { summarizeFeatures });

        await detectKey('clip-that-does-not-exist');

        expect(summarizeFeatures).not.toHaveBeenCalled();
    });
});

describe('audioToMidi', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not create tracks when the clip has no audio buffer', async () => {
        const addTrack = vi.fn();
        const addClip = vi.fn();
        const addMidiNote = vi.fn();
        injectDependencies(audioToMidi, { addTrack, addClip, addMidiNote });

        await audioToMidi('clip-that-does-not-exist');

        expect(addTrack).not.toHaveBeenCalled();
        expect(addClip).not.toHaveBeenCalled();
        expect(addMidiNote).not.toHaveBeenCalled();
    });
});
