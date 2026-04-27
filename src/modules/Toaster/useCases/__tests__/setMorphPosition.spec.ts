import { describe, it, expect, vi, beforeEach } from 'vitest';

type Morph = { position: number; targetPatternId: string | null; enabled: boolean };
type Instances = Record<string, { morph: Morph }>;

const DEVICE_ID = 'd1';

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = {
        value: null as Record<
            string,
            { morph: { position: number; targetPatternId: string | null; enabled: boolean } }
        > | null,
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
        mockStore.value = { [DEVICE_ID]: { morph: { position: 0, targetPatternId: null, enabled: false } } };
        setMock.mockClear();
    });

    it('setMorphPosition clamps to [0, 1]', () => {
        setMorphPosition(DEVICE_ID, 2);
        expect((setMock.mock.calls[0]![0] as Instances)[DEVICE_ID]!.morph.position).toBe(1);
        setMock.mockClear();
        mockStore.value = { [DEVICE_ID]: { morph: { position: 0, targetPatternId: null, enabled: false } } };
        setMorphPosition(DEVICE_ID, -0.5);
        expect((setMock.mock.calls[0]![0] as Instances)[DEVICE_ID]!.morph.position).toBe(0);
    });

    it('setMorphTarget enables morph when target is non-null', () => {
        setMorphTarget(DEVICE_ID, 'p2');
        const next = (setMock.mock.calls[0]![0] as Instances)[DEVICE_ID]!;
        expect(next.morph.targetPatternId).toBe('p2');
        expect(next.morph.enabled).toBe(true);
    });

    it('setMorphTarget disables morph when target is null', () => {
        setMorphTarget(DEVICE_ID, null);
        expect((setMock.mock.calls[0]![0] as Instances)[DEVICE_ID]!.morph.enabled).toBe(false);
    });

    it('toggleMorph flips the enabled flag', () => {
        toggleMorph(DEVICE_ID);
        expect((setMock.mock.calls[0]![0] as Instances)[DEVICE_ID]!.morph.enabled).toBe(true);
    });

    it('all operations noop when store is empty', () => {
        mockStore.value = null;
        setMorphPosition(DEVICE_ID, 0.5);
        setMorphTarget(DEVICE_ID, 'p1');
        toggleMorph(DEVICE_ID);
        expect(setMock).not.toHaveBeenCalled();
    });
});
