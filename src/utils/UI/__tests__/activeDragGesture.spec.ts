import { afterEach, describe, expect, it } from 'vitest';

import { beginDragGesture, isDragGestureActive } from '../activeDragGesture';

describe('activeDragGesture', () => {
    afterEach(() => {
        document.documentElement.removeAttribute('data-drag-gesture-active');
    });

    it('is inactive until a drag begins and inactive again once it ends', () => {
        expect(isDragGestureActive()).toBe(false);
        const end = beginDragGesture();
        expect(isDragGestureActive()).toBe(true);
        end();
        expect(isDragGestureActive()).toBe(false);
    });

    it('stays active until every overlapping drag has ended', () => {
        const endFirst = beginDragGesture();
        const endSecond = beginDragGesture();
        endFirst();
        expect(isDragGestureActive()).toBe(true);
        endSecond();
        expect(isDragGestureActive()).toBe(false);
    });

    it('ignores a second end call from the same drag', () => {
        const endFirst = beginDragGesture();
        const endSecond = beginDragGesture();
        endFirst();
        endFirst();
        expect(isDragGestureActive()).toBe(true);
        endSecond();
    });
});
