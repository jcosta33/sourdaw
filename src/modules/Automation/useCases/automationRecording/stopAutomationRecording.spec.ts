import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { stopAutomationRecording } from './stopAutomationRecording';

describe('stopAutomationRecording', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('resolves track list via injected getAllTracks', () => {
        const getAllTracks = vi.fn().mockReturnValue([]);
        injectDependencies(stopAutomationRecording, { getAllTracks });

        stopAutomationRecording();

        expect(getAllTracks).toHaveBeenCalled();
    });
});
