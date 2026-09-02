import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    mountBrowserDisplayScaleHost,
    readBrowserDisplayScaleHostCapability,
    resetBrowserDisplayScaleForChildStartup,
} from '../browserDisplayScaleHost';
import { BROWSER_APPLICATION_FRAME_NAME } from '../resolveAppComposition';

const DISPLAY_SCALE_HOST_CAPABILITY_KEY = '__sourdawBrowserDisplayScaleHost';

describe('mountBrowserDisplayScaleHost', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute('style');
        document.body.removeAttribute('style');
        document.body.innerHTML = '<div id="root"></div>';
        Reflect.deleteProperty(window, DISPLAY_SCALE_HOST_CAPABILITY_KEY);
    });

    afterEach(() => {
        window.dispatchEvent(new Event('pagehide'));
        document.documentElement.removeAttribute('style');
        document.body.removeAttribute('style');
        document.body.replaceChildren();
        Reflect.deleteProperty(window, DISPLAY_SCALE_HOST_CAPABILITY_KEY);
    });

    it.each([
        { scale: 0.5, width: '200vw', height: '200vh' },
        { scale: 1, width: '100vw', height: '100vh' },
        { scale: 2, width: '50vw', height: '50vh' },
    ])('keeps scale $scale inside one isolated browser viewport', ({ scale, width, height }) => {
        const root = document.getElementById('root');
        expect(root).not.toBeNull();
        mountBrowserDisplayScaleHost(root!);

        const frame = document.querySelector('iframe');
        expect(frame).not.toBeNull();
        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'sourdaw:browser-display-scale', scale },
                origin: window.location.origin,
                source: frame!.contentWindow,
            })
        );

        expect(frame!.style.width).toBe(width);
        expect(frame!.style.height).toBe(height);
        expect(frame!.style.transform).toBe(`scale(${String(scale)})`);
        expect(frame!.style.transformOrigin).toBe('top left');
        expect(document.documentElement.style.overflow).toBe('hidden');
        expect(document.body.style.margin).toBe('0px');
        expect(document.body.style.overflow).toBe('hidden');
        expect(root).toHaveStyle({ width: '100%', height: '100%', overflow: 'hidden' });
    });

    it.each([0, -1, 2.01, Number.NaN, Number.POSITIVE_INFINITY, '2', null])(
        'ignores invalid scale message %s',
        (scale) => {
            const root = document.getElementById('root')!;
            mountBrowserDisplayScaleHost(root);
            const frame = document.querySelector('iframe')!;

            window.dispatchEvent(
                new MessageEvent('message', {
                    data: { type: 'sourdaw:browser-display-scale', scale },
                    origin: window.location.origin,
                    source: frame.contentWindow,
                })
            );

            expect(frame.style.width).toBe('100vw');
            expect(frame.style.height).toBe('100vh');
            expect(frame.style.transform).toBe('scale(1)');
        }
    );

    it('ignores messages from another source or origin', () => {
        const root = document.getElementById('root')!;
        mountBrowserDisplayScaleHost(root);
        const frame = document.querySelector('iframe')!;

        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'sourdaw:browser-display-scale', scale: 2 },
                origin: 'https://example.com',
                source: frame.contentWindow,
            })
        );
        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'sourdaw:browser-display-scale', scale: 2 },
                origin: window.location.origin,
                source: window,
            })
        );

        expect(frame.style.width).toBe('100vw');
        expect(frame.style.height).toBe('100vh');
        expect(frame.style.transform).toBe('scale(1)');
    });

    it('lets only its exact child reset the frame synchronously for startup', () => {
        const root = document.getElementById('root')!;
        mountBrowserDisplayScaleHost(root);
        const frame = document.querySelector('iframe')!;

        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'sourdaw:browser-display-scale', scale: 2 },
                origin: window.location.origin,
                source: frame.contentWindow,
            })
        );
        const capability = readBrowserDisplayScaleHostCapability(window);
        expect(capability).toBeDefined();

        capability?.resetForChildStartup(window);
        expect(frame.style.transform).toBe('scale(2)');

        capability?.resetForChildStartup(frame.contentWindow!);
        expect(frame.style.width).toBe('100vw');
        expect(frame.style.height).toBe('100vh');
        expect(frame.style.transform).toBe('scale(1)');
    });

    it('does not invoke a browser host startup reset from a top-level direct application', () => {
        const resetForChildStartup = vi.fn();
        Reflect.set(window, DISPLAY_SCALE_HOST_CAPABILITY_KEY, { resetForChildStartup });

        resetBrowserDisplayScaleForChildStartup();

        expect(resetForChildStartup).not.toHaveBeenCalled();
    });

    it('keeps display-scale messages active while the host is stored in the back-forward cache', () => {
        const root = document.getElementById('root')!;
        mountBrowserDisplayScaleHost(root);
        const frame = document.querySelector('iframe')!;
        const capability = readBrowserDisplayScaleHostCapability(window);

        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        expect(readBrowserDisplayScaleHostCapability(window)).toBe(capability);
        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'sourdaw:browser-display-scale', scale: 2 },
                origin: window.location.origin,
                source: frame.contentWindow,
            })
        );

        expect(frame.style.transform).toBe('scale(2)');
        capability?.resetForChildStartup(frame.contentWindow!);
        expect(frame.style.transform).toBe('scale(1)');
    });

    it('focuses the application on load and persisted restore until the host is permanently unloaded', () => {
        const root = document.getElementById('root')!;
        mountBrowserDisplayScaleHost(root);
        const frame = document.querySelector('iframe')!;
        const focusApplication = vi.spyOn(frame.contentWindow!, 'focus').mockImplementation(() => undefined);

        frame.dispatchEvent(new Event('load'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

        expect(focusApplication).toHaveBeenCalledTimes(2);

        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        frame.dispatchEvent(new Event('load'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

        expect(focusApplication).toHaveBeenCalledTimes(2);
    });

    it('removes display-scale messages when the host is permanently unloaded', () => {
        const root = document.getElementById('root')!;
        mountBrowserDisplayScaleHost(root);
        const frame = document.querySelector('iframe')!;

        window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
        expect(readBrowserDisplayScaleHostCapability(window)).toBeUndefined();
        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'sourdaw:browser-display-scale', scale: 2 },
                origin: window.location.origin,
                source: frame.contentWindow,
            })
        );

        expect(frame.style.transform).toBe('scale(1)');
    });

    it('names the application frame so a nested reload stays the application composition', () => {
        const root = document.getElementById('root')!;
        mountBrowserDisplayScaleHost(root);
        const frame = document.querySelector('iframe');

        expect(frame).not.toBeNull();
        expect(frame!.name).toBe(BROWSER_APPLICATION_FRAME_NAME);
        expect(frame!.title).toBe('Sourdaw');
    });

    it('reapplies a persisted scale after the child resets the frame for remount', () => {
        const root = document.getElementById('root')!;
        mountBrowserDisplayScaleHost(root);
        const frame = document.querySelector('iframe')!;

        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'sourdaw:browser-display-scale', scale: 2 },
                origin: window.location.origin,
                source: frame.contentWindow,
            })
        );
        readBrowserDisplayScaleHostCapability(window)?.resetForChildStartup(frame.contentWindow!);
        expect(frame.style.transform).toBe('scale(1)');
        expect(frame.style.width).toBe('100vw');

        window.dispatchEvent(
            new MessageEvent('message', {
                data: { type: 'sourdaw:browser-display-scale', scale: 2 },
                origin: window.location.origin,
                source: frame.contentWindow,
            })
        );

        expect(frame.style.width).toBe('50vw');
        expect(frame.style.height).toBe('50vh');
        expect(frame.style.transform).toBe('scale(2)');
    });
});
