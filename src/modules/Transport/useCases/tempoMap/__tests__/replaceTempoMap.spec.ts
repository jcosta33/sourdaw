import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { notificationMock, setMock, storeState } = vi.hoisted(() => {
    const storeState = {
        value: null as {
            changes: Array<{ id: string; beat: number; tempo: number; curve: 'instant' | 'linear' }>;
        } | null,
    };
    const notificationMock = vi.fn();
    const setMock = vi.fn((next: typeof storeState.value) => {
        storeState.value = next;
        notificationMock(next);
    });
    return { notificationMock, setMock, storeState };
});

vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        get value() {
            return storeState.value;
        },
        set: setMock,
    },
}));

import { replaceTempoMap } from '../replaceTempoMap';

describe('replaceTempoMap', () => {
    beforeEach(() => {
        storeState.value = {
            changes: [{ id: 'prior', beat: 4, tempo: 110, curve: 'instant' }],
        };
        setMock.mockClear();
        notificationMock.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('replaces the map in supplied order with short deterministic IDs and one notification', () => {
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('12345678-1234-4123-8123-123456789abc')
            .mockReturnValueOnce('abcdef12-abcd-4abc-8abc-abcdef123456');

        replaceTempoMap({
            changes: [
                { beat: 88, tempo: 72, curve: 'linear' },
                { beat: 0, tempo: 90, curve: 'instant' },
            ],
        });

        const expected = {
            changes: [
                { id: 'tempo-12345678', beat: 88, tempo: 72, curve: 'linear' },
                { id: 'tempo-abcdef12', beat: 0, tempo: 90, curve: 'instant' },
            ],
        };
        expect(setMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(notificationMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(storeState.value).toEqual(expected);
    });

    it('accepts an empty replacement batch without generating IDs', () => {
        const randomUUIDMock = vi.spyOn(crypto, 'randomUUID');

        replaceTempoMap({ changes: [] });

        const expected = { changes: [] };
        expect(randomUUIDMock).not.toHaveBeenCalled();
        expect(setMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(notificationMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(storeState.value).toEqual(expected);
    });

    it('rejects the complete batch before UUID generation when a tempo is invalid', () => {
        const prior = storeState.value;
        const randomUUIDMock = vi.spyOn(crypto, 'randomUUID');

        expect(() =>
            replaceTempoMap({
                changes: [
                    { beat: 0, tempo: 90, curve: 'instant' },
                    { beat: 88, tempo: Number.POSITIVE_INFINITY, curve: 'linear' },
                ],
            })
        ).toThrow(new RangeError('Tempo must be finite and between 20 and 999'));
        expect(randomUUIDMock).not.toHaveBeenCalled();
        expect(setMock).not.toHaveBeenCalled();
        expect(notificationMock).not.toHaveBeenCalled();
        expect(storeState.value).toBe(prior);
    });

    it('initializes the map when the store state is null', () => {
        storeState.value = null;
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('feedface-feed-4ace-8eed-feedfacefeed');

        replaceTempoMap({ changes: [{ beat: 12, tempo: 128, curve: 'instant' }] });

        const expected = {
            changes: [{ id: 'tempo-feedface', beat: 12, tempo: 128, curve: 'instant' }],
        };
        expect(setMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(notificationMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(storeState.value).toEqual(expected);
    });

    it('leaves prior state untouched when ID construction throws', () => {
        const prior = storeState.value;
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('12345678-1234-4123-8123-123456789abc')
            .mockImplementationOnce(() => {
                throw new Error('UUID failure');
            });

        expect(() =>
            replaceTempoMap({
                changes: [
                    { beat: 0, tempo: 90, curve: 'instant' },
                    { beat: 88, tempo: 72, curve: 'linear' },
                ],
            })
        ).toThrow('UUID failure');
        expect(setMock).not.toHaveBeenCalled();
        expect(notificationMock).not.toHaveBeenCalled();
        expect(storeState.value).toBe(prior);
    });
});
