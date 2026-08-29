import { useEffect, useState, type ReactElement } from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { applyDisplayScale } from '../../../useCases/applyDisplayScale';
import { WorkspaceMobileGate } from '../WorkspaceMobileGate';

const displayScaleMocks = vi.hoisted(() => ({
    listeners: new Set<() => void>(),
    preferences: { current: { uiScale: 1 } },
}));

vi.mock('#/modules/Preferences/stores', () => ({
    preferencesStore: {
        get value() {
            return displayScaleMocks.preferences.current;
        },
        subscribe(listener: () => void) {
            displayScaleMocks.listeners.add(listener);
            return () => {
                displayScaleMocks.listeners.delete(listener);
            };
        },
    },
}));

vi.mock('../../../useCases/applyDisplayScale', () => ({ applyDisplayScale: vi.fn() }));

const MOBILE_BREAKPOINT = 768;

const childMounted = vi.fn();

/**
 * Stands in for `AppShell`. The mount effect is the whole point: `AppShell` starts the
 * audio engine, loads the project, starts MIDI and installs the autosave interval from
 * mount effects, so "did the child mount" is exactly "did that work run". The undo depth
 * stands in for state a remount destroys — `loadProject` ends in `clearUndoHistory()`.
 */
const ShellProbe = (): ReactElement => {
    const [undoDepth, setUndoDepth] = useState(0);

    useEffect(() => {
        childMounted();
    }, []);

    return (
        <div data-testid="shell-probe">
            <button type="button" onClick={() => setUndoDepth((depth) => depth + 1)}>
                edit
            </button>
            <span data-testid="undo-depth">{undoDepth}</span>
        </div>
    );
};

const originalInnerWidth = window.innerWidth;
const originalMatchMedia = window.matchMedia;

type MediaSubscription = {
    query: string;
    listener: (event: MediaQueryListEvent) => void;
};

let mediaSubscriptions: MediaSubscription[] = [];

const matchesQuery = (query: string, width: number): boolean => {
    if (query.includes('min-width')) {
        return width >= MOBILE_BREAKPOINT;
    }
    return width < MOBILE_BREAKPOINT;
};

const setViewportWidth = (width: number): void => {
    window.innerWidth = width;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: matchesQuery(query, width),
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
            mediaSubscriptions.push({ query, listener });
        },
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
            mediaSubscriptions = mediaSubscriptions.filter((entry) => entry.listener !== listener);
        },
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
};

/** Moves the viewport and notifies every live subscription the way a real resize does. */
const resizeViewportTo = (width: number): void => {
    setViewportWidth(width);
    act(() => {
        for (const subscription of [...mediaSubscriptions]) {
            subscription.listener({ matches: matchesQuery(subscription.query, width) } as MediaQueryListEvent);
        }
    });
};

describe('WorkspaceMobileGate', () => {
    beforeEach(() => {
        mediaSubscriptions = [];
        childMounted.mockClear();
        displayScaleMocks.listeners.clear();
        displayScaleMocks.preferences.current = { uiScale: 1 };
        vi.mocked(applyDisplayScale).mockReset();
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

    it('latches the unscaled desktop viewport before reapplying a stored 200% scale', () => {
        setViewportWidth(1440);
        displayScaleMocks.preferences.current = { uiScale: 2 };
        vi.mocked(applyDisplayScale).mockImplementation((scale) => {
            setViewportWidth(1440 / scale);
        });

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        expect(applyDisplayScale).toHaveBeenCalledWith(2);
        expect(window.innerWidth).toBe(720);
        expect(screen.getByTestId('shell-probe')).toBeInTheDocument();

        resizeViewportTo(720);

        expect(screen.getByTestId('shell-probe')).toBeInTheDocument();
        expect(childMounted).toHaveBeenCalledTimes(1);
    });

    it('does not apply a stored 50% scale or mount its children on a phone viewport', () => {
        setViewportWidth(393);
        displayScaleMocks.preferences.current = { uiScale: 0.5 };

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        expect(screen.getByText('Desktop DAW')).toBeInTheDocument();
        expect(screen.queryByTestId('shell-probe')).not.toBeInTheDocument();
        expect(childMounted).not.toHaveBeenCalled();
        expect(applyDisplayScale).not.toHaveBeenCalled();
        expect(displayScaleMocks.listeners.size).toBe(0);
    });

    it('applies and subscribes to display scale only after the viewport becomes desktop eligible', () => {
        setViewportWidth(375);
        displayScaleMocks.preferences.current = { uiScale: 0.5 };

        const { unmount } = render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        expect(childMounted).not.toHaveBeenCalled();
        expect(applyDisplayScale).not.toHaveBeenCalled();
        expect(displayScaleMocks.listeners.size).toBe(0);

        resizeViewportTo(1280);

        expect(screen.getByTestId('shell-probe')).toBeInTheDocument();
        expect(childMounted).toHaveBeenCalledTimes(1);
        expect(applyDisplayScale).toHaveBeenCalledWith(0.5);
        expect(displayScaleMocks.listeners.size).toBe(1);

        unmount();
        expect(displayScaleMocks.listeners.size).toBe(0);
    });

    it('preserves shell state when a desktop window is resized below the breakpoint and back', () => {
        // 200% browser zoom on a 1400px window, DevTools docked to the side, or a
        // dragged-narrow desktop app window all put `innerWidth` under 768 mid-session.
        setViewportWidth(1440);

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        fireEvent.click(screen.getByRole('button', { name: 'edit' }));
        fireEvent.click(screen.getByRole('button', { name: 'edit' }));
        expect(screen.getByTestId('undo-depth')).toHaveTextContent('2');

        resizeViewportTo(700);
        resizeViewportTo(1440);

        // Unmounting the shell here re-runs its boot effect, and `loadProject`
        // ends in `clearUndoHistory()` — the user's session would be discarded.
        expect(screen.getByTestId('undo-depth')).toHaveTextContent('2');
        expect(childMounted).toHaveBeenCalledTimes(1);
    });
});
