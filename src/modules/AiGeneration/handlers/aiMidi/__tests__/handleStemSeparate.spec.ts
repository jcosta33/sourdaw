import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleStemSeparate } from '../handleStemSeparate';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(),
    addTrack: vi.fn(),
    cacheSet: vi.fn(),
    cacheGet: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    separateStems: vi.fn(),
    audioBufferToWav: vi.fn(),
    trackStoreValue: { value: null } as any,
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: mocks.addClip,
    addTrack: mocks.addTrack,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { set: mocks.cacheSet, get: mocks.cacheGet },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info, warn: mocks.warn },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    separateStems: mocks.separateStems,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioBufferToWav: mocks.audioBufferToWav,
}));

describe('handleStemSeparate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStoreValue.value = null;
    });

    it('bails if clip cannot be found', async () => {
        mocks.trackStoreValue.value = { tracks: [] };

        await expect(
            handleStemSeparate.execute({
                type: 'stemSeparate',
                payload: { clipId: 'missing' },
            })
        ).rejects.toThrow('Clip not found');

        expect(mocks.notifyUser).toHaveBeenCalledWith('Stem separation failed: clip not found', 'error');
        expect(mocks.separateStems).not.toHaveBeenCalled();
    });

    it('bails if clip is not audio or missing buffer', async () => {
        mocks.trackStoreValue.value = {
            tracks: [
                {
                    clips: [
                        { id: 'c1', type: 'midi' },
                        { id: 'c2', type: 'audio', audioBufferId: null },
                    ],
                },
            ],
        };

        await expect(handleStemSeparate.execute({ type: 'stemSeparate', payload: { clipId: 'c1' } })).rejects.toThrow();
        expect(mocks.notifyUser).toHaveBeenCalledWith('Stem separation failed: clip has no audio buffer', 'error');

        await expect(handleStemSeparate.execute({ type: 'stemSeparate', payload: { clipId: 'c2' } })).rejects.toThrow();
    });

    it('bails if buffer cannot be loaded from cache', async () => {
        mocks.trackStoreValue.value = {
            tracks: [{ clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf1' }] }],
        };
        mocks.cacheGet.mockReturnValue(null);

        await expect(handleStemSeparate.execute({ type: 'stemSeparate', payload: { clipId: 'c1' } })).rejects.toThrow();

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Stem separation failed: audio buffer not found in cache',
            'error'
        );
    });

    it('separates stems, creates tracks, and adds clips', async () => {
        mocks.trackStoreValue.value = {
            tracks: [
                {
                    clips: [
                        {
                            id: 'c1',
                            name: 'Vocals',
                            type: 'audio',
                            audioBufferId: 'buf1',
                            startBeat: 0,
                            endBeat: 4,
                        },
                    ],
                },
            ],
        };

        const mockBuffer = {} as AudioBuffer;
        mocks.cacheGet.mockReturnValue(mockBuffer);
        mocks.audioBufferToWav.mockReturnValue(new ArrayBuffer(10));

        mocks.separateStems.mockResolvedValue({
            vocals: {} as AudioBuffer,
            drums: {} as AudioBuffer,
        });

        let trackIdCounter = 0;
        mocks.addTrack.mockImplementation(() => ({ id: `t${++trackIdCounter}` }));

        await handleStemSeparate.execute({
            type: 'stemSeparate',
            payload: { clipId: 'c1', stems: ['vocals', 'drums'] },
        });

        expect(mocks.separateStems).toHaveBeenCalledWith(expect.any(ArrayBuffer), ['vocals', 'drums']);
        expect(mocks.addTrack).toHaveBeenCalledTimes(2);
        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Vocals — vocals', kind: 'audio' });
        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'Vocals — drums', kind: 'audio' });

        expect(mocks.addClip).toHaveBeenCalledTimes(2);
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 't1',
                name: 'vocals',
            })
        );
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 't2',
                name: 'drums',
            })
        );

        expect(mocks.info).toHaveBeenCalledWith('[Audio AI] Separated into 2 stems');
    });

    it('logs warning if separation throws', async () => {
        mocks.trackStoreValue.value = {
            tracks: [{ clips: [{ id: 'c1', type: 'audio', audioBufferId: 'buf1' }] }],
        };
        mocks.cacheGet.mockReturnValue({} as AudioBuffer);
        mocks.separateStems.mockRejectedValue(new Error('Oops'));

        await expect(handleStemSeparate.execute({ type: 'stemSeparate', payload: { clipId: 'c1' } })).rejects.toThrow(
            'Oops'
        );

        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('Oops'));
    });

    it('provides a description', () => {
        const desc = handleStemSeparate.describe({ type: 'stemSeparate', payload: { clipId: 'c1' } });
        expect(desc.label).toBe('AI: separate stems');
    });
});
