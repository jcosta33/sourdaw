import { useRef, type ReactElement } from 'react';

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useElementWidth } from '../useElementWidth';

type ObserverRecord = {
    callback: ResizeObserverCallback;
    observed: Element[];
    disconnected: boolean;
};

const observers: ObserverRecord[] = [];

class RecordingResizeObserver {
    private readonly record: ObserverRecord;
    constructor(callback: ResizeObserverCallback) {
        this.record = { callback, observed: [], disconnected: false };
        observers.push(this.record);
    }
    observe(target: Element): void {
        this.record.observed.push(target);
    }
    unobserve(): void {}
    disconnect(): void {
        this.record.disconnected = true;
    }
}

const entryWithWidth = (target: Element, width: number): ResizeObserverEntry =>
    ({ target, contentRect: { width } }) as ResizeObserverEntry;

const Probe = ({ fallback }: { fallback: number }): ReactElement => {
    const ref = useRef<HTMLDivElement>(null);
    const width = useElementWidth(ref, fallback);
    return (
        <div ref={ref} data-testid="measured">
            {width}
        </div>
    );
};

const resize = (width: number): void => {
    const [record] = observers;
    const target = record?.observed[0];
    if (!record || !target) {
        throw new Error('the hook never observed an element');
    }
    act(() => {
        record.callback([entryWithWidth(target, width)], {} as ResizeObserver);
    });
};

describe('useElementWidth', () => {
    beforeEach(() => {
        observers.length = 0;
        vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns the fallback until the element reports a width, and observes that element', () => {
        render(<Probe fallback={240} />);

        expect(screen.getByTestId('measured')).toHaveTextContent('240');
        expect(observers).toHaveLength(1);
        expect(observers[0]?.observed).toEqual([screen.getByTestId('measured')]);
    });

    it('follows the reported content width, floored to whole pixels', () => {
        render(<Probe fallback={240} />);

        resize(172.9);
        expect(screen.getByTestId('measured')).toHaveTextContent('172');

        resize(301);
        expect(screen.getByTestId('measured')).toHaveTextContent('301');
    });

    it('keeps the last good width when the element collapses to zero', () => {
        render(<Probe fallback={240} />);

        resize(180);
        resize(0);

        expect(screen.getByTestId('measured')).toHaveTextContent('180');
    });

    it('disconnects the observer on unmount', () => {
        const view = render(<Probe fallback={240} />);
        expect(observers[0]?.disconnected).toBe(false);

        view.unmount();

        expect(observers[0]?.disconnected).toBe(true);
    });
});
