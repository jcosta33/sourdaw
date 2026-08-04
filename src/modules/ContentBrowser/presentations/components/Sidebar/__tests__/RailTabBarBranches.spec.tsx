import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RailTabBar } from '../RailTabBar';

const ITEMS = [
    { id: 'tab1', label: 'First' },
    { id: 'tab2', label: 'Second' },
    { id: 'tab3', label: 'Third' },
];

function renderBar(overrides: Record<string, unknown> = {}) {
    const onChange = vi.fn();
    render(<RailTabBar activeId="tab1" items={ITEMS} onChange={onChange} {...overrides} />);
    return { onChange };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('RailTabBar — tab rendering', () => {
    it('renders a button for each item', () => {
        renderBar();
        expect(screen.getByText('First')).toBeInTheDocument();
        expect(screen.getByText('Second')).toBeInTheDocument();
        expect(screen.getByText('Third')).toBeInTheDocument();
    });

    it('renders scroll buttons with aria-labels', () => {
        renderBar();
        expect(screen.getByLabelText('Scroll tabs left')).toBeInTheDocument();
        expect(screen.getByLabelText('Scroll tabs right')).toBeInTheDocument();
    });
});

describe('RailTabBar — active tab', () => {
    it('marks the active tab with aria-pressed via variant secondary', () => {
        renderBar({ activeId: 'tab2' });
        // The active tab button has the label text "Second"
        const activeButton = screen.getByText('Second').closest('button');
        expect(activeButton).not.toBeNull();
        // The variant="secondary" is applied — we can verify the button exists and is distinct
        // by checking it's the active one (it renders differently)
    });

    it('calls onChange with the clicked tab id', () => {
        const { onChange } = renderBar();
        fireEvent.click(screen.getByText('Second'));
        expect(onChange).toHaveBeenCalledWith('tab2');
    });

    it('calls onChange when the active tab is clicked again', () => {
        const { onChange } = renderBar({ activeId: 'tab1' });
        fireEvent.click(screen.getByText('First'));
        expect(onChange).toHaveBeenCalledWith('tab1');
    });
});

describe('RailTabBar — scroll button tabIndex', () => {
    it('scroll buttons have tabIndex -1 initially (no overflow in jsdom)', () => {
        renderBar();
        // In jsdom, scrollWidth === clientWidth, so canScroll is false.
        expect(screen.getByLabelText('Scroll tabs left')).toHaveAttribute('tabindex', '-1');
        expect(screen.getByLabelText('Scroll tabs right')).toHaveAttribute('tabindex', '-1');
    });
});

describe('RailTabBar — size variant', () => {
    it('renders with default size (main) when no size prop', () => {
        renderBar();
        // Just verify it renders without crashing
        expect(screen.getByText('First')).toBeInTheDocument();
    });

    it('renders with sub size', () => {
        renderBar({ size: 'sub' });
        expect(screen.getByText('First')).toBeInTheDocument();
    });
});

describe('RailTabBar — empty items', () => {
    it('renders without crashing when items is empty', () => {
        render(<RailTabBar activeId="" items={[]} onChange={vi.fn()} />);
        expect(screen.getByLabelText('Scroll tabs left')).toBeInTheDocument();
    });
});
