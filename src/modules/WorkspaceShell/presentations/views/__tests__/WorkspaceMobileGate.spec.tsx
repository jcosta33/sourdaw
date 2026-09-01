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

type DeviceClass = {
    coarsePointer: boolean;
    screenWidth: number;
    screenHeight: number;
    innerWidth: number;
};

// iPhone 15 CSS screen in both orientations, iPad mini portrait, and fine-pointer desktops.
const PHONE_PORTRAIT: DeviceClass = { coarsePointer: true, screenWidth: 393, screenHeight: 852, innerWidth: 393 };
const PHONE_LANDSCAPE: DeviceClass = { coarsePointer: true, screenWidth: 852, screenHeight: 393, innerWidth: 852 };
const TABLET_PORTRAIT: DeviceClass = { coarsePointer: true, screenWidth: 744, screenHeight: 1133, innerWidth: 744 };
const DESKTOP: DeviceClass = { coarsePointer: false, screenWidth: 1920, screenHeight: 1080, innerWidth: 1440 };

const originalInnerWidth = window.innerWidth;
const originalScreen = window.screen;
const originalMatchMedia = window.matchMedia;

type MediaSubscription = {
    query: string;
    listener: (event: MediaQueryListEvent) => void;
};

let device: DeviceClass = DESKTOP;
let mediaSubscriptions: MediaSubscription[] = [];

const mediaMatches = (query: string): boolean => {
    if (query.includes('pointer: coarse')) {
        return device.coarsePointer;
    }
    const minWidth = /min-width:\s*(\d+)px/.exec(query);
    if (minWidth !== null) {
        return device.innerWidth >= Number(minWidth[1]);
    }
    return false;
};

const setDevice = (next: DeviceClass): void => {
    device = next;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: next.innerWidth });
    Object.defineProperty(window, 'screen', {
        configurable: true,
        value: { width: next.screenWidth, height: next.screenHeight },
    });
};

/**
 * Rotations and resizes fire the way the real events do, so a gate that kept a live
 * media-query or resize listener would observe them and (wrongly) flip its decision.
 */
const changeDeviceTo = (next: DeviceClass): void => {
    setDevice(next);
    act(() => {
        window.dispatchEvent(new Event('resize'));
        for (const subscription of [...mediaSubscriptions]) {
            subscription.listener({
                matches: mediaMatches(subscription.query),
                media: subscription.query,
            } as MediaQueryListEvent);
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
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: mediaMatches(query),
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
    });

    afterEach(() => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
        Object.defineProperty(window, 'screen', { configurable: true, value: originalScreen });
        window.matchMedia = originalMatchMedia;
    });

    it('should mount its children on a fine-pointer desktop', () => {
        setDevice(DESKTOP);

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        expect(screen.getByTestId('shell-probe')).toBeInTheDocument();
        expect(childMounted).toHaveBeenCalledTimes(1);
    });

    it('should mount its children on a fine-pointer desktop with a narrow window', () => {
        setDevice({ ...DESKTOP, innerWidth: 480 });

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        expect(screen.getByTestId('shell-probe')).toBeInTheDocument();
        expect(childMounted).toHaveBeenCalledTimes(1);
    });

    it('should keep the shell mounted when a stored 200% scale narrows the window', () => {
        setDevice(DESKTOP);
        displayScaleMocks.preferences.current = { uiScale: 2 };
        vi.mocked(applyDisplayScale).mockImplementation((scale) => {
            setDevice({ ...device, innerWidth: device.innerWidth / scale });
        });

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        expect(applyDisplayScale).toHaveBeenCalledWith(2);
        expect(window.innerWidth).toBe(720);
        expect(screen.getByTestId('shell-probe')).toBeInTheDocument();

        changeDeviceTo(device);

        expect(screen.getByTestId('shell-probe')).toBeInTheDocument();
        expect(childMounted).toHaveBeenCalledTimes(1);
    });

    it('should not apply a stored scale or mount its children on a phone', () => {
        setDevice(PHONE_PORTRAIT);
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

    it('should not mount its children while a phone rotates to landscape and back', () => {
        setDevice(PHONE_PORTRAIT);

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        changeDeviceTo(PHONE_LANDSCAPE);
        changeDeviceTo(PHONE_PORTRAIT);

        expect(screen.getByText('Desktop DAW')).toBeInTheDocument();
        expect(screen.queryByTestId('shell-probe')).not.toBeInTheDocument();
        expect(childMounted).not.toHaveBeenCalled();
        expect(applyDisplayScale).not.toHaveBeenCalled();
        expect(displayScaleMocks.listeners.size).toBe(0);
    });

    it('should mount its children and sync display scale on a coarse-pointer tablet in portrait', () => {
        setDevice(TABLET_PORTRAIT);
        displayScaleMocks.preferences.current = { uiScale: 1.5 };

        const { unmount } = render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        expect(screen.getByTestId('shell-probe')).toBeInTheDocument();
        expect(childMounted).toHaveBeenCalledTimes(1);
        expect(applyDisplayScale).toHaveBeenCalledWith(1.5);
        expect(displayScaleMocks.listeners.size).toBe(1);

        unmount();
        expect(displayScaleMocks.listeners.size).toBe(0);
    });

    it('should preserve shell state when a desktop window is resized below 768px and back', () => {
        // 200% browser zoom on a 1400px window, DevTools docked to the side, or a
        // dragged-narrow desktop app window all put `innerWidth` under 768 mid-session.
        setDevice(DESKTOP);

        render(
            <WorkspaceMobileGate>
                <ShellProbe />
            </WorkspaceMobileGate>
        );

        fireEvent.click(screen.getByRole('button', { name: 'edit' }));
        fireEvent.click(screen.getByRole('button', { name: 'edit' }));
        expect(screen.getByTestId('undo-depth')).toHaveTextContent('2');

        changeDeviceTo({ ...DESKTOP, innerWidth: 700 });
        changeDeviceTo(DESKTOP);

        // Unmounting the shell here re-runs its boot effect, and `loadProject`
        // ends in `clearUndoHistory()` — the user's session would be discarded.
        expect(screen.getByTestId('undo-depth')).toHaveTextContent('2');
        expect(childMounted).toHaveBeenCalledTimes(1);
    });
});
