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

    it('renders nothing when Web MIDI is unsupported', () => {
        useStoreMock.mockReturnValue({ isSupported: false, inputs: [], selectedInputId: null });

        const { container } = renderBadge();

        expect(container).toBeEmptyDOMElement();
    });

    it('shows a disconnected label when Web MIDI is supported but no input is selected', () => {
        useStoreMock.mockReturnValue({ isSupported: true, inputs: [buildInput()], selectedInputId: null });

        renderBadge();

        expect(screen.getByRole('button', { name: 'No MIDI device connected' })).toHaveTextContent('No MIDI');
    });

    it('shows the connected device name when a known input is selected', () => {
        useStoreMock.mockReturnValue({
            isSupported: true,
            inputs: [buildInput()],
            selectedInputId: 'input-1',
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
        });

        renderBadge();

        expect(screen.getByRole('button')).toHaveAccessibleName('MIDI: Launchkey Mini');
    });

    it('opens the preferences dialog when clicked', () => {
        useStoreMock.mockReturnValue({ isSupported: true, inputs: [], selectedInputId: null });

        renderBadge();
        fireEvent.click(screen.getByRole('button'));

        expect(openPreferencesDialog).toHaveBeenCalledTimes(1);
    });
});
