import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createTrackForPlugin } from './pluginBrowserActions';

describe('createTrackForPlugin', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns null when addTrack fails', () => {
        const addTrack = vi.fn().mockReturnValue(null);
        const addExternalDevice = vi.fn();
        injectDependencies(createTrackForPlugin, { addTrack, addExternalDevice });

        expect(createTrackForPlugin('T', 'midi')).toBeNull();
    });
});
