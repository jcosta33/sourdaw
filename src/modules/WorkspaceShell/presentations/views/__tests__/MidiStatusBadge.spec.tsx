import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';

import { openPreferencesDialog } from '../../../useCases/dialogs/openPreferencesDialog';
import { MidiStatusBadge } from '../MidiStatusBadge';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(),
}));

vi.mock('../../../useCases/dialogs/openPreferencesDialog', () => ({
    openPreferencesDialog: vi.fn(),
}));

const useStoreMock = vi.mocked(useStore);

type MidiInputFixture = { id: string; name: string; manufacturer: string };

const buildInput = (overrides: Partial<MidiInputFixture> = {}): MidiInputFixture => ({
    id: 'input-1',
    name: 'Launchkey Mini',
    manufacturer: 'Novation',
    ...overrides,
});

const renderBadge = (): ReturnType<typeof render> =>
    render(
        <TooltipProvider delayDuration={0}>
            <MidiStatusBadge />
        </TooltipProvider>
    );

describe('MidiStatusBadge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows a causal unavailable status when the browser has no MIDI route', () => {
        useStoreMock.mockReturnValue({ isSupported: false, inputs: [], selectedInputId: null, enumerationError: null });

        renderBadge();

        expect(screen.getByRole('button', { name: /MIDI input is not supported in this browser/i })).toHaveTextContent(
            'MIDI unavailable'
        );
    });

    it('shows a runtime access failure without claiming the browser API is absent', () => {
        useStoreMock.mockReturnValue({
            isSupported: false,
            inputs: [],
            selectedInputId: null,
            enumerationError: 'Permission denied',
        });

        renderBadge();

        const button = screen.getByRole('button', { name: /Permission denied/i });
        expect(button).toHaveTextContent('MIDI unavailable');
        expect(button).not.toHaveAccessibleName(/not supported in this browser/i);
    });

    it('shows native enumeration errors without marking native MIDI unsupported', () => {
        useStoreMock.mockReturnValue({
            isSupported: true,
            inputs: [],
            selectedInputId: null,
            enumerationError: 'Native MIDI list failed',
        });

        renderBadge();

        expect(screen.getByRole('button', { name: /Native MIDI list failed/i })).toHaveTextContent('MIDI error');
    });

    it('shows a disconnected label when Web MIDI is supported but no input is selected', () => {
        useStoreMock.mockReturnValue({
            isSupported: true,
            inputs: [buildInput()],
            selectedInputId: null,
            enumerationError: null,
        });

        renderBadge();

        expect(screen.getByRole('button', { name: 'No MIDI device connected' })).toHaveTextContent('No MIDI');
    });

    it('shows the connected device name when a known input is selected', () => {
        useStoreMock.mockReturnValue({
            isSupported: true,
            inputs: [buildInput()],
            selectedInputId: 'input-1',
            enumerationError: null,
        });

        renderBadge();

        const button = screen.getByRole('button', { name: 'MIDI: Launchkey Mini (Novation)' });
        expect(button).toHaveTextContent('Launchkey Mini');
    });

    it('truncates device names longer than the display limit', () => {
        useStoreMock.mockReturnValue({
            isSupported: true,
            inputs: [buildInput({ name: 'Extremely Long Controller Name', manufacturer: 'Unknown' })],
            selectedInputId: 'input-1',
            enumerationError: null,
        });

        renderBadge();

        expect(screen.getByText('Extremely Long…')).toBeInTheDocument();
        expect(screen.getByRole('button')).toHaveAccessibleName('MIDI: Extremely Long Controller Name');
    });

    it('omits the manufacturer suffix when it is Unknown', () => {
        useStoreMock.mockReturnValue({
            isSupported: true,
            inputs: [buildInput({ manufacturer: 'Unknown' })],
            selectedInputId: 'input-1',
            enumerationError: null,
        });

        renderBadge();

        expect(screen.getByRole('button')).toHaveAccessibleName('MIDI: Launchkey Mini');
    });

    it('opens the preferences dialog when clicked', () => {
        useStoreMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: null, enumerationError: null });

        renderBadge();
        fireEvent.click(screen.getByRole('button'));

        expect(openPreferencesDialog).toHaveBeenCalledTimes(1);
    });
});
