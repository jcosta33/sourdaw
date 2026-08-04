import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DawCompactSelect } from '../DawCompactSelect';
import { DawPluginToggle } from '../DawPluginToggle';

describe('DawPluginToggle — label computation', () => {
    it('shows "ON" when pressed with default labels', () => {
        render(<DawPluginToggle pressed>ON</DawPluginToggle>);
        // When children provided, children override
        expect(screen.getByText('ON')).toBeInTheDocument();
    });

    it('shows default onLabel "ON" when pressed and no children', () => {
        const { container } = render(<DawPluginToggle pressed />);
        expect(container.querySelector('button')).toHaveTextContent('ON');
    });

    it('shows default offLabel "OFF" when not pressed and no children', () => {
        const { container } = render(<DawPluginToggle pressed={false} />);
        expect(container.querySelector('button')).toHaveTextContent('OFF');
    });

    it('shows custom onLabel when pressed', () => {
        const { container } = render(<DawPluginToggle pressed onLabel="Active" />);
        expect(container.querySelector('button')).toHaveTextContent('Active');
    });

    it('shows custom offLabel when not pressed', () => {
        const { container } = render(<DawPluginToggle pressed={false} offLabel="Bypassed" />);
        expect(container.querySelector('button')).toHaveTextContent('Bypassed');
    });

    it('children override takes priority over pressed label', () => {
        const { container } = render(
            <DawPluginToggle pressed onLabel="ON">
                <span data-testid="custom">Custom Label</span>
            </DawPluginToggle>
        );
        expect(screen.getByTestId('custom')).toBeInTheDocument();
        expect(container.querySelector('button')).toHaveTextContent('Custom Label');
    });
});

describe('DawPluginToggle — aria-pressed', () => {
    it('aria-pressed is true when pressed', () => {
        render(<DawPluginToggle pressed />);
        expect(container().querySelector('button')).toHaveAttribute('aria-pressed', 'true');
    });

    it('aria-pressed is false when not pressed', () => {
        render(<DawPluginToggle pressed={false} />);
        expect(container().querySelector('button')).toHaveAttribute('aria-pressed', 'false');
    });
});

describe('DawPluginToggle — onClick passthrough', () => {
    it('fires onClick from props', () => {
        const onClick = vi.fn();
        render(<DawPluginToggle pressed onClick={onClick} />);
        fireEvent.click(container().querySelector('button')!);
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});

function container() {
    return document.body;
}

describe('DawCompactSelect — native select rendering', () => {
    it('renders a combobox with children options', () => {
        render(
            <DawCompactSelect defaultValue="a">
                <option value="a">Alpha</option>
                <option value="b">Beta</option>
            </DawCompactSelect>
        );
        expect(screen.getByRole('combobox')).toBeInTheDocument();
        expect(screen.getByText('Alpha')).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
    });

    it('renders with defaultValue', () => {
        render(
            <DawCompactSelect defaultValue="b">
                <option value="a">Alpha</option>
                <option value="b">Beta</option>
            </DawCompactSelect>
        );
        expect(screen.getByRole('combobox')).toHaveValue('b');
    });
});

describe('DawCompactSelect — onChange', () => {
    it('fires onChange when selection changes', () => {
        const onChange = vi.fn();
        render(
            <DawCompactSelect defaultValue="a" onChange={onChange}>
                <option value="a">Alpha</option>
                <option value="b">Beta</option>
            </DawCompactSelect>
        );
        fireEvent.change(screen.getByRole('combobox'), { target: { value: 'b' } });
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});
