import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mountBrowserDisplayScaleHost } from '../browserDisplayScaleHost';

describe('mountBrowserDisplayScaleHost', () => {
    beforeEach(() => {
        document.documentElement.removeAttribute('style');
        document.body.removeAttribute('style');
        document.body.innerHTML = '<div id="root"></div>';
    });

    afterEach(() => {
        window.dispatchEvent(new Event('pagehide'));
        document.documentElement.removeAttribute('style');
        document.body.removeAttribute('style');
        document.body.replaceChildren();
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
});
