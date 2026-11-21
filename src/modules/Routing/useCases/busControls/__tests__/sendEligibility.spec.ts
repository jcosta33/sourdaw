import { beforeEach, describe, expect, it, vi } from 'vitest';

import { removeSend } from '../removeSend';
import { setSend } from '../setSend';

const mocks = vi.hoisted(() => ({
    tracks: [] as Array<{ id: string; kind: string }>,
    setSendEngine: vi.fn(),
    removeSendEngine: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return { tracks: mocks.tracks };
        },
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    setSend: mocks.setSendEngine,
    removeSend: mocks.removeSendEngine,
}));

describe('routing send eligibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tracks = [
            { id: 'audio-1', kind: 'audio' },
            { id: 'bus-1', kind: 'bus' },
            { id: 'vca-1', kind: 'vca' },
        ];
    });

    it('rejects dormant VCA send sources and destinations', () => {
        setSend('vca-1', 'bus-1', 0.5);
        setSend('audio-1', 'vca-1', 0.5);

        expect(mocks.setSendEngine).not.toHaveBeenCalled();
    });

    it('preserves ordinary send routing', () => {
        setSend('audio-1', 'bus-1', 0.5, true);

        expect(mocks.setSendEngine).toHaveBeenCalledWith('audio-1', 'bus-1', 0.5, true);
    });

    it('permits dormant VCA send teardown', () => {
        removeSend('vca-1', 'bus-1');

        expect(mocks.removeSendEngine).toHaveBeenCalledWith('vca-1', 'bus-1');
    });
});
