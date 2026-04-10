import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Track } from '../../models/Track';
import { renderTrackOffline } from './renderOffline';

describe('renderTrackOffline', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not build a device chain for non-audio non-midi tracks', async () => {
        const buildDeviceChain = vi.fn();
        const getAudioContext = vi.fn().mockReturnValue({ sampleRate: 44100 });
        injectDependencies(renderTrackOffline, { buildDeviceChain, getAudioContext });

        const busTrack = { kind: 'bus', clips: [], devices: [] } as unknown as Track;
        const result = await renderTrackOffline(busTrack, 0, 4);

        expect(result).toBeNull();
        expect(buildDeviceChain).not.toHaveBeenCalled();
    });
});
