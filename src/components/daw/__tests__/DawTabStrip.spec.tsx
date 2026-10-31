import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DawTabStrip, getDawTabId, type DawTabStripItem } from '../DawTabStrip';

const ITEMS: DawTabStripItem<string>[] = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Beta', activeClassName: 'is-active-beta', className: 'always-beta' },
    { id: 'c', label: 'Gamma', attributes: { 'data-testid': 'gamma-tab', 'data-onboarding': 'gamma' } },
];

type StripOverrides = Partial<Parameters<typeof DawTabStrip<string>>[0]>;

const renderStrip = (overrides: StripOverrides = {}) => {
    const onChange = vi.fn();
    const props = {
        label: 'Letters',
        idPrefix: 'letters-tab',
        items: ITEMS,
        activeId: 'a',
        onChange,
        ...overrides,
    };
    const view = render(<DawTabStrip {...props} />);
    return { onChange, props, rerender: (next: StripOverrides) => view.rerender(<DawTabStrip {...props} {...next} />) };
};

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });

const scrollMetricRestorers: (() => void)[] = [];

// jsdom lays nothing out, so the scroll metrics the strip reads are defined on the prototype and
// removed again after each case.
const mockScrollMetrics = (state: { scrollWidth: number; clientWidth: number; scrollLeft: number }) => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => state.scrollWidth });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => state.clientWidth });
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
        configurable: true,
        get: () => state.scrollLeft,
        set: (value: number) => {
            state.scrollLeft = value;
        },
    });
    scrollMetricRestorers.push(() => {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
        Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollLeft');
    });
    return state;
};

afterEach(() => {
    vi.restoreAllMocks();
    for (const restore of scrollMetricRestorers.splice(0)) {
        restore();
    }
});

describe('DawTabStrip semantics', () => {
    it('exposes a named tablist of tabs with exactly the active tab selected', () => {
        renderStrip({ activeId: 'b' });

        expect(screen.getByRole('tablist', { name: 'Letters' })).toBeInTheDocument();
        expect(screen.getAllByRole('tab')).toHaveLength(3);
        expect(tab('Alpha')).toHaveAttribute('aria-selected', 'false');
        expect(tab('Beta')).toHaveAttribute('aria-selected', 'true');
        expect(tab('Gamma')).toHaveAttribute('aria-selected', 'false');
    });

    it('gives each tab a stable DOM id built from the prefix', () => {
        renderStrip();

        expect(tab('Beta')).toHaveAttribute('id', getDawTabId('letters-tab', 'b'));
        expect(tab('Beta')).toHaveAttribute('id', 'letters-tab-b');
    });

    it('points aria-controls at the panel only when the caller provides one', () => {
        const { rerender } = renderStrip({ panelId: 'letters-panel' });
        expect(tab('Alpha')).toHaveAttribute('aria-controls', 'letters-panel');
        expect(tab('Gamma')).toHaveAttribute('aria-controls', 'letters-panel');

        rerender({ panelId: undefined });
        expect(tab('Alpha')).not.toHaveAttribute('aria-controls');
    });

    it('keeps only the selected tab in the tab order', () => {
        renderStrip({ activeId: 'b' });

        expect(tab('Alpha')).toHaveAttribute('tabindex', '-1');
        expect(tab('Beta')).toHaveAttribute('tabindex', '0');
        expect(tab('Gamma')).toHaveAttribute('tabindex', '-1');
    });

    it('falls back to the first tab as the tab stop when the active id is not in the strip', () => {
        renderStrip({ activeId: 'missing' });

        expect(tab('Alpha')).toHaveAttribute('tabindex', '0');
        expect(tab('Beta')).toHaveAttribute('tabindex', '-1');
    });

    it('applies per-tab classes and attributes, with the active class only on the selected tab', () => {
        const { rerender } = renderStrip({ activeId: 'a' });
        expect(tab('Beta').className).toContain('always-beta');
        expect(tab('Beta').className).not.toContain('is-active-beta');
        expect(screen.getByTestId('gamma-tab')).toHaveAttribute('data-onboarding', 'gamma');

        rerender({ activeId: 'b' });
        expect(tab('Beta').className).toContain('is-active-beta');
    });

    it('reports the clicked tab, including the already selected one', () => {
        const { onChange } = renderStrip({ activeId: 'a' });

        fireEvent.click(tab('Gamma'));
        fireEvent.click(tab('Alpha'));

        expect(onChange.mock.calls).toEqual([['c'], ['a']]);
    });
});

describe('DawTabStrip keyboard', () => {
    it('moves focus with the arrow keys and wraps at both ends without selecting', () => {
        const { onChange } = renderStrip({ activeId: 'a' });
        tab('Alpha').focus();

        fireEvent.keyDown(tab('Alpha'), { key: 'ArrowRight' });
        expect(tab('Beta')).toHaveFocus();

        fireEvent.keyDown(tab('Beta'), { key: 'ArrowRight' });
        fireEvent.keyDown(tab('Gamma'), { key: 'ArrowRight' });
        expect(tab('Alpha')).toHaveFocus();

        fireEvent.keyDown(tab('Alpha'), { key: 'ArrowLeft' });
        expect(tab('Gamma')).toHaveFocus();

        expect(onChange).not.toHaveBeenCalled();
    });

    it('jumps to the first and last tab with Home and End', () => {
        renderStrip({ activeId: 'b' });
        tab('Beta').focus();

        fireEvent.keyDown(tab('Beta'), { key: 'End' });
        expect(tab('Gamma')).toHaveFocus();

        fireEvent.keyDown(tab('Gamma'), { key: 'Home' });
        expect(tab('Alpha')).toHaveFocus();
    });

    it('prevents the default of a handled key and leaves other keys alone', () => {
        renderStrip();
        tab('Alpha').focus();

        expect(fireEvent.keyDown(tab('Alpha'), { key: 'ArrowRight' })).toBe(false);
        expect(fireEvent.keyDown(tab('Beta'), { key: 'a' })).toBe(true);
        expect(fireEvent.keyDown(tab('Beta'), { key: 'ArrowDown' })).toBe(true);
    });

    it('keeps the keys it handles from reaching window-level shortcuts, and lets every other key through', () => {
        const windowKeydown = vi.fn<(event: KeyboardEvent) => void>();
        window.addEventListener('keydown', windowKeydown);
        try {
            renderStrip({ activeId: 'b' });
            tab('Beta').focus();

            for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) {
                fireEvent.keyDown(document.activeElement ?? tab('Beta'), { key });
            }
            expect(windowKeydown).not.toHaveBeenCalled();

            fireEvent.keyDown(tab('Beta'), { key: 'a' });
            fireEvent.keyDown(tab('Beta'), { key: ' ' });
            expect(windowKeydown.mock.calls.map(([event]) => event.key)).toEqual(['a', ' ']);
        } finally {
            window.removeEventListener('keydown', windowKeydown);
        }
    });

    it('ignores arrow keys held with a modifier so browser shortcuts survive', () => {
        renderStrip();
        tab('Alpha').focus();

        expect(fireEvent.keyDown(tab('Alpha'), { key: 'ArrowRight', altKey: true })).toBe(true);
        expect(tab('Alpha')).toHaveFocus();
    });

    it('does not move focus for a key pressed outside a tab', () => {
        renderStrip();

        fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });

        expect(document.body).toHaveFocus();
    });
});

const rectAt = (left: number, right: number): DOMRect => ({
    left,
    right,
    x: left,
    y: 0,
    top: 0,
    bottom: 20,
    width: right - left,
    height: 20,
    toJSON: () => ({}),
});

// The scroller spans 0..300 and the tabs sit at fixed viewport positions, so a tab past either
// edge is hidden or under the 24px fade. Tabs not listed sit comfortably inside.
const mockTabPositions = (positions: Record<string, [number, number]>) =>
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this.getAttribute('role') === 'tablist') {
            return rectAt(0, 300);
        }
        const position = positions[this.textContent ?? ''];
        return position ? rectAt(position[0], position[1]) : rectAt(100, 150);
    });

describe('DawTabStrip reveal on selection', () => {
    it('scrolls a newly selected tab that is clipped on the right into view', () => {
        const metrics = mockScrollMetrics({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
        mockTabPositions({ Gamma: [320, 420] });
        const { rerender } = renderStrip({ activeId: 'a' });
        expect(metrics.scrollLeft).toBe(0);

        rerender({ activeId: 'c' });

        // Gamma ends at 420; it must clear the 24px fade at 276, so 144px of scroll.
        expect(metrics.scrollLeft).toBe(144);
    });

    it('scrolls a newly selected tab that is clipped on the left into view', () => {
        const metrics = mockScrollMetrics({ scrollWidth: 600, clientWidth: 300, scrollLeft: 200 });
        mockTabPositions({ Alpha: [-120, -20] });
        const { rerender } = renderStrip({ activeId: 'c' });
        metrics.scrollLeft = 200;

        rerender({ activeId: 'a' });

        // Alpha starts at -120; it must clear the 24px fade at 24, so 144px back.
        expect(metrics.scrollLeft).toBe(56);
    });

    it('leaves the scroll position alone when the selected tab is already visible', () => {
        const metrics = mockScrollMetrics({ scrollWidth: 600, clientWidth: 300, scrollLeft: 40 });
        mockTabPositions({ Beta: [60, 160] });
        const { rerender } = renderStrip({ activeId: 'a' });

        rerender({ activeId: 'b' });

        expect(metrics.scrollLeft).toBe(40);
    });

    it('reveals the selected tab when another tab appears in the strip', () => {
        const metrics = mockScrollMetrics({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
        mockTabPositions({ Beta: [320, 420] });
        const { rerender } = renderStrip({ items: ITEMS.slice(0, 1), activeId: 'a' });
        expect(metrics.scrollLeft).toBe(0);

        // The strip gains a second tab and the selection moves onto it in the same render.
        rerender({ items: ITEMS.slice(0, 2), activeId: 'b' });

        expect(metrics.scrollLeft).toBe(144);
    });
});

describe('DawTabStrip overflow affordance', () => {
    it('shows no scroll affordance when the tabs fit', async () => {
        mockScrollMetrics({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
        renderStrip();

        await waitFor(() => expect(screen.getByLabelText('Scroll tabs right')).toHaveAttribute('tabindex', '-1'));
        expect(screen.getByLabelText('Scroll tabs left')).toHaveAttribute('tabindex', '-1');
    });

    it('offers scrolling right only while more tabs exist on the right', async () => {
        const metrics = mockScrollMetrics({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
        renderStrip();

        await waitFor(() => expect(screen.getByLabelText('Scroll tabs right')).toHaveAttribute('tabindex', '0'));
        expect(screen.getByLabelText('Scroll tabs left')).toHaveAttribute('tabindex', '-1');

        metrics.scrollLeft = 150;
        fireEvent.scroll(screen.getByRole('tablist'));
        await waitFor(() => expect(screen.getByLabelText('Scroll tabs left')).toHaveAttribute('tabindex', '0'));
        expect(screen.getByLabelText('Scroll tabs right')).toHaveAttribute('tabindex', '0');

        metrics.scrollLeft = 300;
        fireEvent.scroll(screen.getByRole('tablist'));
        await waitFor(() => expect(screen.getByLabelText('Scroll tabs right')).toHaveAttribute('tabindex', '-1'));
        expect(screen.getByLabelText('Scroll tabs left')).toHaveAttribute('tabindex', '0');
    });

    it('scrolls the strip by a step when a scroll button is used', async () => {
        mockScrollMetrics({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
        const scrollBy = vi.fn();
        Object.defineProperty(HTMLElement.prototype, 'scrollBy', { configurable: true, value: scrollBy });
        scrollMetricRestorers.push(() => Reflect.deleteProperty(HTMLElement.prototype, 'scrollBy'));
        renderStrip();

        await waitFor(() => expect(screen.getByLabelText('Scroll tabs right')).toHaveAttribute('tabindex', '0'));
        fireEvent.click(screen.getByLabelText('Scroll tabs right'));

        expect(scrollBy).toHaveBeenCalledWith({ left: 80, behavior: 'smooth' });
    });

    it('renders an empty strip without tabs', () => {
        renderStrip({ items: [], activeId: '' });

        expect(screen.getByRole('tablist', { name: 'Letters' })).toBeInTheDocument();
        expect(screen.queryAllByRole('tab')).toHaveLength(0);
    });
});
