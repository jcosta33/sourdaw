import { useEffect, type ReactElement } from 'react';

import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { WorkspaceMobileGate } from '../WorkspaceMobileGate';

const childMounted = vi.fn();

/**
 * Stands in for `AppShell`. The effect is the whole point: `AppShell` starts the
 * audio engine, loads the project, starts MIDI and installs the autosave interval
 * from mount effects, so "did the child mount" is exactly "did that work run".
 */
const ShellProbe = (): ReactElement => {
    useEffect(() => {
        childMounted();
    }, []);

    return <div data-testid="shell-probe">Shell</div>;
};

const originalInnerWidth = window.innerWidth;
const originalMatchMedia = window.matchMedia;

type MediaListener = (event: MediaQueryListEvent) => void;

let mediaListeners: MediaListener[] = [];

const setViewportWidth = (width: number): void => {
    window.innerWidth = width;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: width < 768,
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: MediaListener) => {
            mediaListeners.push(listener);
        },
        removeEventListener: (_type: string, listener: MediaListener) => {
            mediaListeners = mediaListeners.filter((entry) => entry !== listener);
        },
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
};

const emitMediaChange = (matches: boolean): void => {
    act(() => {
        for (const listener of [...mediaListeners]) {
            listener({ matches } as MediaQueryListEvent);
        }
    });
};

describe('WorkspaceMobileGate', () => {
    beforeEach(() => {
        mediaListeners = [];
        childMounted.mockClear();
    });

    afterEach(() => {
        window.innerWidth = originalInnerWidth;
        window.matchMedia = originalMatchMedia;
    });

    it('mounts its children on a desktop viewport', () => {
        setViewportWidth(1280);

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        expect(screen.getByTestId('shell-probe')).toBeInTheDocument();
        expect(childMounted).toHaveBeenCalledTimes(1);
    });

    it('never mounts its children on a phone viewport, so no shell effect runs', () => {
        setViewportWidth(375);

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        expect(screen.getByText('Desktop DAW')).toBeInTheDocument();
        expect(screen.queryByTestId('shell-probe')).not.toBeInTheDocument();
        expect(childMounted).not.toHaveBeenCalled();
    });

    it('mounts the children when the viewport widens past the breakpoint', () => {
        setViewportWidth(375);

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        expect(childMounted).not.toHaveBeenCalled();

        emitMediaChange(false);

        expect(screen.getByTestId('shell-probe')).toBeInTheDocument();
        expect(childMounted).toHaveBeenCalledTimes(1);
    });
});
