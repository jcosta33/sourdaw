import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { notificationMock, setMock, storeState } = vi.hoisted(() => {
    const storeState = {
        value: null as {
            changes: Array<{ id: string; beat: number; numerator: number; denominator: number }>;
        } | null,
    };
    const notificationMock = vi.fn();
    const setMock = vi.fn((next: typeof storeState.value) => {
        storeState.value = next;
        notificationMock(next);
    });
    return { notificationMock, setMock, storeState };
});

vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: {
        get value() {
            return storeState.value;
        },
        set: setMock,
    },
}));

import { replaceTimeSignatureMap } from '../replaceTimeSignatureMap';

describe('replaceTimeSignatureMap', () => {
    beforeEach(() => {
        storeState.value = {
            changes: [{ id: 'prior', beat: 16, numerator: 5, denominator: 4 }],
        };
        setMock.mockClear();
        notificationMock.mockClear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('replaces the map in supplied order with short deterministic IDs and one notification', () => {
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
            .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');

        replaceTimeSignatureMap({
            changes: [
                { beat: 48, numerator: 6, denominator: 8 },
                { beat: 0, numerator: 4, denominator: 4 },
            ],
        });

        const expected = {
            changes: [
                { id: 'ts-11111111', beat: 48, numerator: 6, denominator: 8 },
                { id: 'ts-22222222', beat: 0, numerator: 4, denominator: 4 },
            ],
        };
        expect(setMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(notificationMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(storeState.value).toEqual(expected);
    });

    it('accepts an empty replacement batch without generating IDs', () => {
        const randomUUIDMock = vi.spyOn(crypto, 'randomUUID');

        replaceTimeSignatureMap({ changes: [] });

        const expected = { changes: [] };
        expect(randomUUIDMock).not.toHaveBeenCalled();
        expect(setMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(notificationMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(storeState.value).toEqual(expected);
    });

    it('rejects the complete batch before UUID generation when a denominator is invalid', () => {
        const prior = storeState.value;
        const randomUUIDMock = vi.spyOn(crypto, 'randomUUID');

        expect(() =>
            replaceTimeSignatureMap({
                changes: [
                    { beat: 0, numerator: 4, denominator: 4 },
                    { beat: 48, numerator: 6, denominator: 3.5 },
                ],
            })
        ).toThrow(new RangeError('Time-signature denominator must be an integer between 1 and 32'));
        expect(randomUUIDMock).not.toHaveBeenCalled();
        expect(setMock).not.toHaveBeenCalled();
        expect(notificationMock).not.toHaveBeenCalled();
        expect(storeState.value).toBe(prior);
    });

    it('initializes the map when the store state is null', () => {
        storeState.value = null;
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('33333333-3333-4333-8333-333333333333');

        replaceTimeSignatureMap({ changes: [{ beat: 24, numerator: 7, denominator: 8 }] });

        const expected = {
            changes: [{ id: 'ts-33333333', beat: 24, numerator: 7, denominator: 8 }],
        };
        expect(setMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(notificationMock).toHaveBeenCalledExactlyOnceWith(expected);
        expect(storeState.value).toEqual(expected);
    });

    it('leaves prior state untouched when ID construction throws', () => {
        const prior = storeState.value;
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
            .mockImplementationOnce(() => {
                throw new Error('UUID failure');
            });

        expect(() =>
            replaceTimeSignatureMap({
                changes: [
                    { beat: 0, numerator: 4, denominator: 4 },
                    { beat: 48, numerator: 6, denominator: 8 },
                ],
            })
        ).toThrow('UUID failure');
        expect(setMock).not.toHaveBeenCalled();
        expect(notificationMock).not.toHaveBeenCalled();
        expect(storeState.value).toBe(prior);
    });
});
