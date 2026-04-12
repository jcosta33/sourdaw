import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = {
        value: null as { morph: { position: number; targetPatternId: string | null; enabled: boolean } } | null,
    };
    const setMock = vi.fn((next: typeof ref.value) => {
        ref.value = next;
    });
    return { setMock, mockStore: ref };
});

vi.mock('../../stores/toasterStore', () => ({
    toasterStore: {
        get value() {
            return mockStore.value;
        },
        set: setMock,
    },
}));

import { setMorphPosition } from '../setMorphPosition/setMorphPosition';
import { setMorphTarget } from '../setMorphPosition/setMorphTarget';
import { toggleMorph } from '../setMorphPosition/toggleMorph';

describe('toaster morph operations', () => {
    beforeEach(() => {
        mockStore.value = { morph: { position: 0, targetPatternId: null, enabled: false } };
        setMock.mockClear();
    });

    it('setMorphPosition clamps to [0, 1]', () => {
        setMorphPosition(2);
        expect(setMock.mock.calls[0]![0]!.morph.position).toBe(1);
        setMock.mockClear();
        setMorphPosition(-0.5);
        expect(setMock.mock.calls[0]![0]!.morph.position).toBe(0);
    });

    it('setMorphTarget enables morph when target is non-null', () => {
        setMorphTarget('p2');
        expect(setMock.mock.calls[0]![0]!.morph.targetPatternId).toBe('p2');
        expect(setMock.mock.calls[0]![0]!.morph.enabled).toBe(true);
    });

    it('setMorphTarget disables morph when target is null', () => {
        setMorphTarget(null);
        expect(setMock.mock.calls[0]![0]!.morph.enabled).toBe(false);
    });

    it('toggleMorph flips the enabled flag', () => {
        toggleMorph();
        expect(setMock.mock.calls[0]![0]!.morph.enabled).toBe(true);
    });

    it('all operations noop when store is empty', () => {
        mockStore.value = null;
        setMorphPosition(0.5);
        setMorphTarget('p1');
        toggleMorph();
        expect(setMock).not.toHaveBeenCalled();
    });
});
