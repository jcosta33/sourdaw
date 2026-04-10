import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { startAutomationRecording } from './startAutomationRecording';

describe('startAutomationRecording', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not throw when automation store is empty', () => {
        const getAllTracks = vi.fn().mockReturnValue([]);
        injectDependencies(startAutomationRecording, { getAllTracks });

        expect(() => {
            startAutomationRecording();
        }).not.toThrow();

        expect(getAllTracks).toHaveBeenCalled();
    });
});
