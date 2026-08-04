import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DawCompactTextarea } from '../DawCompactTextarea';
import { DawDisplaySurface } from '../DawDisplaySurface';
import { DawTransportCluster } from '../DawTransportCluster';

describe('DawCompactTextarea — monospace and native props', () => {
    it('renders a textarea', () => {
        render(<DawCompactTextarea />);
        expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('monospace=false does not add font-mono', () => {
        const { container } = render(<DawCompactTextarea />);
        expect(container.querySelector('textarea')!.className).not.toContain('font-mono');
    });

    it('monospace=true adds font-mono', () => {
        const { container } = render(<DawCompactTextarea monospace />);
        expect(container.querySelector('textarea')!.className).toContain('font-mono');
    });

    it('passes through placeholder', () => {
        render(<DawCompactTextarea placeholder="Type here" />);
        expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Type here');
    });

    it('fires onChange', () => {
        const onChange = vi.fn();
        render(<DawCompactTextarea onChange={onChange} />);
        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test' } });
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe('DawTransportCluster — tone variants', () => {
    it('default tone is strip', () => {
        render(<DawTransportCluster>Content</DawTransportCluster>);
        expect(screen.getByText('Content').parentElement).toHaveProperty('className');
    });

    it('tone=well adds daw-readout-well class', () => {
        const { container } = render(<DawTransportCluster tone="well">X</DawTransportCluster>);
        expect(container.firstChild!.textContent).toBe('X');
        expect((container.firstChild as HTMLElement).className).toContain('daw-readout-well');
    });

    it('tone=strip adds daw-control-strip class', () => {
        const { container } = render(<DawTransportCluster tone="strip">X</DawTransportCluster>);
        expect((container.firstChild as HTMLElement).className).toContain('daw-control-strip');
    });

    it('renders children', () => {
        render(<DawTransportCluster>Content</DawTransportCluster>);
        expect(screen.getByText('Content')).toBeInTheDocument();
    });
});

describe('DawDisplaySurface — accentTop and children', () => {
    it('renders children', () => {
        render(<DawDisplaySurface>Display</DawDisplaySurface>);
        expect(screen.getByText('Display')).toBeInTheDocument();
    });

    it('accentTop=false does not add border-top class', () => {
        const { container } = render(<DawDisplaySurface>X</DawDisplaySurface>);
        expect((container.firstChild as HTMLElement).className).not.toContain('border-t-');
    });

    it('accentTop=true adds border-top accent class', () => {
        const { container } = render(<DawDisplaySurface accentTop>X</DawDisplaySurface>);
        expect((container.firstChild as HTMLElement).className).toContain('border-t-');
    });
});
