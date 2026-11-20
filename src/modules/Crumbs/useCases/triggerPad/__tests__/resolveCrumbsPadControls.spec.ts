import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getAllTracks: vi.fn(), ensureTrackStrip: vi.fn() }));
vi.mock('#/modules/Arrangement/useCases', () => ({ getAllTracks: mocks.getAllTracks }));
vi.mock('#/modules/AudioEngine/useCases', () => ({ ensureTrackStrip: mocks.ensureTrackStrip }));
import { resolveCrumbsPadControls } from '../resolveCrumbsPadControls';

describe('resolveCrumbsPadControls', () => {
    it('selects the ready device with the requested id on its owning track', () => {
        const first = { ready: true };
        const target = { ready: true };
        mocks.getAllTracks.mockReturnValue([{ id: 'track', devices: [{ id: 'first' }, { id: 'target' }] }]);
        mocks.ensureTrackStrip.mockReturnValue({
            deviceNodes: [
                { deviceId: 'first', crumbsControls: first },
                { deviceId: 'target', crumbsControls: target },
            ],
        });
        expect(resolveCrumbsPadControls('target')).toBe(target);
        expect(mocks.ensureTrackStrip).toHaveBeenCalledWith('track');
    });
});
