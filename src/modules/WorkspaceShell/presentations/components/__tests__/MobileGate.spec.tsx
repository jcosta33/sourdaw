import { useEffect, type ReactElement } from 'react';

import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { expectExternalProjectLink } from '../../__tests__/expectExternalProjectLink';
import { MobileGate } from '../MobileGate';

type DeviceClass = {
    coarsePointer: boolean;
    screenWidth: number;
    screenHeight: number;
    innerWidth: number;
};

// iPhone 15 CSS screen in both orientations, iPad mini portrait, and a
// fine-pointer desktop whose window is dragged narrower than a phone.
const PHONE_PORTRAIT: DeviceClass = { coarsePointer: true, screenWidth: 393, screenHeight: 852, innerWidth: 393 };
const PHONE_LANDSCAPE: DeviceClass = { coarsePointer: true, screenWidth: 852, screenHeight: 393, innerWidth: 852 };
const TABLET_PORTRAIT: DeviceClass = { coarsePointer: true, screenWidth: 744, screenHeight: 1133, innerWidth: 744 };
const DESKTOP_NARROW_WINDOW: DeviceClass = {
    coarsePointer: false,
    screenWidth: 1920,
    screenHeight: 1080,
    innerWidth: 480,
};

const originalInnerWidth = window.innerWidth;
const originalScreen = window.screen;
const originalMatchMedia = window.matchMedia;

type MediaSubscription = {
    query: string;
    listener: (event: MediaQueryListEvent) => void;
};

let device: DeviceClass = DESKTOP_NARROW_WINDOW;
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
const rotateDeviceTo = (next: DeviceClass): void => {
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

const childMounted = vi.fn();

const ProbeChild = (): ReactElement => {
    useEffect(() => {
        childMounted();
    }, []);

    return <span data-testid="child">Desktop</span>;
};

beforeEach(() => {
    mediaSubscriptions = [];
    childMounted.mockClear();
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
    vi.restoreAllMocks();
});

describe('MobileGate', () => {
    it('should show the notice on a coarse-pointer phone screen in portrait', () => {
        setDevice(PHONE_PORTRAIT);

        render(
            <MobileGate>
                <ProbeChild />
            </MobileGate>
        );

        expect(screen.queryByTestId('child')).toBeNull();
        expect(childMounted).not.toHaveBeenCalled();
        expect(screen.getByText(/This dough needs more room/)).toBeTruthy();
    });

    it('should keep the notice on a coarse-pointer phone screen in landscape', () => {
        setDevice(PHONE_LANDSCAPE);

        render(
            <MobileGate>
                <ProbeChild />
            </MobileGate>
        );

        expect(screen.queryByTestId('child')).toBeNull();
        expect(childMounted).not.toHaveBeenCalled();
        expect(screen.getByText(/This dough needs more room/)).toBeTruthy();
    });

    it('should not mount children while a phone rotates to landscape and back', () => {
        setDevice(PHONE_PORTRAIT);

        render(
            <MobileGate>
                <ProbeChild />
            </MobileGate>
        );

        rotateDeviceTo(PHONE_LANDSCAPE);
        rotateDeviceTo(PHONE_PORTRAIT);

        expect(screen.queryByTestId('child')).toBeNull();
        expect(childMounted).not.toHaveBeenCalled();
        expect(screen.getByText(/This dough needs more room/)).toBeTruthy();
    });

    it('should mount children on a coarse-pointer tablet screen in portrait', () => {
        setDevice(TABLET_PORTRAIT);

        render(
            <MobileGate>
                <ProbeChild />
            </MobileGate>
        );

        expect(screen.getByTestId('child')).toBeTruthy();
        expect(screen.queryByText(/This dough needs more room/)).toBeNull();
    });

    it('should mount children on a fine-pointer desktop with a narrow window', () => {
        setDevice(DESKTOP_NARROW_WINDOW);

        render(
            <MobileGate>
                <ProbeChild />
            </MobileGate>
        );

        expect(screen.getByTestId('child')).toBeTruthy();
        expect(screen.queryByText(/This dough needs more room/)).toBeNull();
    });
});

describe('MobileGate — mobile view content', () => {
    beforeEach(() => {
        setDevice(PHONE_PORTRAIT);
    });

    it('should show Sourdaw branding text', () => {
        render(
            <MobileGate>
                <span />
            </MobileGate>
        );
        expect(screen.getByText('Sourdaw')).toBeTruthy();
        expect(screen.getByText('Desktop DAW')).toBeTruthy();
    });

    it('should show the full message about larger screens', () => {
        render(
            <MobileGate>
                <span />
            </MobileGate>
        );
        expect(screen.getByText(/larger screen/i)).toBeTruthy();
    });

    it('should route feedback and bug reports to GitHub', () => {
        render(
            <MobileGate>
                <span />
            </MobileGate>
        );
        expectExternalProjectLink(
            screen.getByRole('link', { name: /Discussions/ }),
            'https://github.com/jcosta33/sourdaw/discussions'
        );
        expectExternalProjectLink(
            screen.getByRole('link', { name: /Report a bug/ }),
            'https://github.com/jcosta33/sourdaw/issues'
        );
    });
});
