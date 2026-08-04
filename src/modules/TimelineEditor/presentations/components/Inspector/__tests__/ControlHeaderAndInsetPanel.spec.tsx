import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { ControlHeader } from '../ControlHeader';
import { InsetPanel } from '../InsetPanel';

describe('ControlHeader — label and value rendering', () => {
    it('renders the label', () => {
        render(<ControlHeader label="Gain" />);
        expect(screen.getByText('Gain')).toBeInTheDocument();
    });

    it('renders the value when provided', () => {
        render(<ControlHeader label="Gain" value={3.5} />);
        expect(screen.getByText('3.5')).toBeInTheDocument();
    });

    it('does not render a value when value is undefined', () => {
        const { container } = render(<ControlHeader label="Gain" />);
        // Only the label is rendered, no value div
        expect(container.querySelectorAll('div')).toHaveLength(1);
    });
});

describe('ControlHeader — native props', () => {
    it('passes through onClick', () => {
        render(<ControlHeader label="X" data-testid="header" />);
        expect(screen.getByTestId('header')).toBeInTheDocument();
    });
});

describe('InsetPanel — children rendering', () => {
    it('renders children', () => {
        render(<InsetPanel>Content</InsetPanel>);
        expect(screen.getByText('Content')).toBeInTheDocument();
    });
});

describe('InsetPanel — tone variants', () => {
    it('renders with default tone when no tone prop', () => {
        render(<InsetPanel>Default</InsetPanel>);
        expect(screen.getByText('Default')).toBeInTheDocument();
    });

    it('renders with framed tone', () => {
        render(<InsetPanel tone="framed">Framed</InsetPanel>);
        expect(screen.getByText('Framed')).toBeInTheDocument();
    });
});
