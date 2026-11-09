import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ControlGallery } from '../ControlGallery';

const tokenSource = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');

type ExpectedToken = { name: string; darkValue: string | undefined; lightValue: string | undefined };

function readDeclarations(block: string): [string, string][] {
    return Array.from(block.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm), (match) => {
        const name = match[1];
        const value = match[2];
        if (name === undefined || value === undefined) {
            throw new Error('Expected a complete design token declaration');
        }
        return [name, value.trim()];
    });
}

function tokenValuesFromSource(source: string): ExpectedToken[] {
    const uncommented = source.replace(/\/\*[\s\S]*?\*\//gu, '');
    const darkBlock = /^@theme\s*\{([^}]*)\}/mu.exec(uncommented)?.[1] ?? '';
    const lightBlock = /^:root\.light\s*\{([^}]*)\}/mu.exec(uncommented)?.[1] ?? '';
    const tokens = new Map<string, ExpectedToken>();
    for (const [name, darkValue] of readDeclarations(darkBlock)) {
        tokens.set(name, { name, darkValue, lightValue: undefined });
    }
    for (const [name, lightValue] of readDeclarations(lightBlock)) {
        tokens.set(name, { name, darkValue: tokens.get(name)?.darkValue, lightValue });
    }
    return [...tokens.values()];
}

describe('ControlGallery', () => {
    it('renders every unique CSS token declaration from the source', () => {
        render(<ControlGallery tokenCss={tokenSource} />);
        const tokenList = screen.getByRole('list', { name: 'Design tokens' });
        const rows = within(tokenList).getAllByRole('listitem');
        const names = rows.map((row) => row.getAttribute('data-token-name'));
        expect(names).toEqual(tokenValuesFromSource(tokenSource).map(({ name }) => name));
        expect(names).toEqual(
            expect.arrayContaining(['--text-metadata', '--text-label', '--text-value', '--text-body'])
        );
        expect(rows).toHaveLength(204);
    });

    it('renders every exact Dark value and only source-declared Light overrides', () => {
        render(<ControlGallery tokenCss={tokenSource} />);
        const tokenList = screen.getByRole('list', { name: 'Design tokens' });
        const rows = within(tokenList).getAllByRole('listitem');
        const rowFor = (name: string) => {
            const row = rows.find((candidate) => candidate.getAttribute('data-token-name') === name);
            if (row === undefined) {
                throw new Error(`Missing gallery row for ${name}`);
            }
            return row;
        };

        for (const token of tokenValuesFromSource(tokenSource)) {
            const row = rowFor(token.name);
            expect(row.querySelector('[data-theme-value="dark"]')?.textContent, `${token.name} Dark`).toBe(
                token.darkValue ?? '—'
            );
            const light = row.querySelector('[data-theme-value="light"]');
            if (token.lightValue === undefined) {
                expect(light, `${token.name} has no Light override`).toBeNull();
            } else {
                expect(light?.textContent, `${token.name} Light`).toBe(token.lightValue);
            }
        }
        // Keep one fixed expectation outside the source-derived oracle so a
        // shared source/parser regression cannot move both sides together.
        expect(rowFor('--color-accent-pink').querySelector('[data-theme-value="light"]')?.textContent).toBe('#8a4257');
    });

    it('ignores multiline comment blocks and commented token declarations', () => {
        const fixture = `
/*
@theme {
    --commented-dark: #000000;
}
:root.light {
    --commented-light: #111111;
}
*/
@theme {
    --real-dark: #123456;
    /* --commented-declaration: #badbad; */
}
/*
:root.light {
    --another-commented-light: #222222;
}
*/
:root.light {
    --real-dark: #abcdef;
    --real-light-only: #fedcba;
    /* --another-commented-declaration: #badbad; */
}
`;
        render(<ControlGallery tokenCss={fixture} />);
        const rows = within(screen.getByRole('list', { name: 'Design tokens' })).getAllByRole('listitem');
        expect(rows.map((row) => row.getAttribute('data-token-name'))).toEqual(['--real-dark', '--real-light-only']);
        expect(rows[0]?.querySelector('[data-theme-value="dark"]')?.textContent).toBe('#123456');
        expect(rows[0]?.querySelector('[data-theme-value="light"]')?.textContent).toBe('#abcdef');
        expect(rows[1]?.querySelector('[data-theme-value="dark"]')?.textContent).toBe('—');
        expect(rows[1]?.querySelector('[data-theme-value="light"]')?.textContent).toBe('#fedcba');
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
