import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ControlGallery } from '../ControlGallery';

const tokenSource = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

function tokenNamesFromSource(source: string): string[] {
    const names = new Set<string>();
    for (const match of source.matchAll(/^\s*(--[\w-]+)\s*:\s*[^;]+;/gm)) {
        const name = match[1];
        if (name !== undefined) {
            names.add(name);
        }
    }
    return Array.from(names);
}

describe('ControlGallery', () => {
    it('renders every unique CSS token declaration from the source', () => {
        render(<ControlGallery tokenCss={tokenSource} />);
        const tokenList = screen.getByRole('list', { name: 'Design tokens' });
        const rows = within(tokenList).getAllByRole('listitem');
        expect(rows.map((row) => row.getAttribute('data-token-name'))).toEqual(tokenNamesFromSource(tokenSource));
        expect(rows).toHaveLength(193);
    });

    it('renders the six real shared control categories in supported states', () => {
        render(<ControlGallery tokenCss={tokenSource} />);
        for (const title of ['Knob', 'Fader', 'Toggle', 'LED', 'Meter', 'Display']) {
            expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
        }
        expect(screen.getByText('Learning')).toBeInTheDocument();
        expect(screen.getByText('Mapped')).toBeInTheDocument();
        expect(screen.getByText('Silence:')).toBeInTheDocument();
        expect(screen.getByText('Unity:', { exact: false })).toBeInTheDocument();
        expect(screen.getByText('Headroom:', { exact: false })).toBeInTheDocument();
        expect(screen.getByText('Idle')).toBeInTheDocument();
        expect(screen.getByText('Signal')).toBeInTheDocument();
        expect(screen.getByText('Clipping')).toBeInTheDocument();
        expect(screen.getByText('−12.4 dBFS')).toBeInTheDocument();
        expect(screen.getByText(/RECORDING/)).toBeInTheDocument();
    });

    it('keeps interactions local and exposes visible state changes', () => {
        render(<ControlGallery tokenCss={tokenSource} />);
        const toggle = screen.getByRole('button', { name: 'Gallery bypass' });
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByText('Bypassed')).toBeInTheDocument();

        const knob = screen.getByRole('slider', { name: 'Width' });
        const knobReadout = screen.getByLabelText('Knob value');
        const initialKnobValue = knobReadout.textContent;
        fireEvent.keyDown(knob, { key: 'ArrowUp' });
        expect(knobReadout.textContent).not.toBe(initialKnobValue);

        const fader = screen.getByRole('slider', { name: 'Gallery gain fader' });
        const faderReadout = screen.getByLabelText('Fader value');
        const initialFaderValue = faderReadout.textContent;
        fireEvent.keyDown(fader, { key: 'ArrowUp' });
        expect(faderReadout.textContent).not.toBe(initialFaderValue);

        const meter = screen.getByRole('meter', { name: 'Gallery level meter' });
        expect(meter).toHaveAttribute('aria-valuenow', '68');
        const meterButton = screen.getByRole('button', { name: 'Peak' });
        fireEvent.click(meterButton);
        expect(meterButton).toHaveAttribute('aria-pressed', 'true');
        expect(meter).toHaveAttribute('aria-valuenow', '100');
    });
});
