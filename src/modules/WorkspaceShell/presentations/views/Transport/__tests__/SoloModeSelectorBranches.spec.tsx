import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../useCases/togglePanel/panelToggles/setSoloMode', () => ({
    setSoloMode: vi.fn(),
}));

import { setSoloMode } from '../../../../useCases/togglePanel/panelToggles/setSoloMode';
import { SoloModeSelector } from '../SoloModeSelector';

const mockedSetSoloMode = vi.mocked(setSoloMode);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('SoloModeSelector — radio group structure', () => {
    it('renders a radiogroup with aria-label "Solo mode"', () => {
        render(<SoloModeSelector soloMode="sip" />);
        expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-label', 'Solo mode');
    });

    it('renders exactly 3 radio buttons (SIP, AFL, PFL)', () => {
        render(<SoloModeSelector soloMode="sip" />);
        const radios = screen.getAllByRole('radio');
        expect(radios).toHaveLength(3);
        expect(radios.map((r) => r.textContent)).toEqual(['SIP', 'AFL', 'PFL']);
    });
});

describe('SoloModeSelector — active selection', () => {
    it('marks SIP as checked when soloMode is sip', () => {
        render(<SoloModeSelector soloMode="sip" />);
        const sipButton = screen.getByRole('radio', { name: 'SIP' });
        expect(sipButton).toHaveAttribute('aria-checked', 'true');
    });

    it('marks AFL as checked when soloMode is afl', () => {
        render(<SoloModeSelector soloMode="afl" />);
        const aflButton = screen.getByRole('radio', { name: 'AFL' });
        expect(aflButton).toHaveAttribute('aria-checked', 'true');
        const sipButton = screen.getByRole('radio', { name: 'SIP' });
        expect(sipButton).toHaveAttribute('aria-checked', 'false');
    });

    it('marks PFL as checked when soloMode is pfl', () => {
        render(<SoloModeSelector soloMode="pfl" />);
        const pflButton = screen.getByRole('radio', { name: 'PFL' });
        expect(pflButton).toHaveAttribute('aria-checked', 'true');
    });
});

describe('SoloModeSelector — click wiring', () => {
    it('calls setSoloMode("sip") when SIP clicked', () => {
        render(<SoloModeSelector soloMode="afl" />);
        fireEvent.click(screen.getByRole('radio', { name: 'SIP' }));
        expect(mockedSetSoloMode).toHaveBeenCalledWith('sip');
    });

    it('calls setSoloMode("afl") when AFL clicked', () => {
        render(<SoloModeSelector soloMode="sip" />);
        fireEvent.click(screen.getByRole('radio', { name: 'AFL' }));
        expect(mockedSetSoloMode).toHaveBeenCalledWith('afl');
    });

    it('calls setSoloMode("pfl") when PFL clicked', () => {
        render(<SoloModeSelector soloMode="sip" />);
        fireEvent.click(screen.getByRole('radio', { name: 'PFL' }));
        expect(mockedSetSoloMode).toHaveBeenCalledWith('pfl');
    });
});
