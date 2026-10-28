import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    type MidiNoteOffPayload,
    type MidiNoteOnPayload,
    type MidiPedalCcPayload,
} from '#/modules/WorkspaceShell/events';
import { type YeastNotesOffPayload } from '#/modules/Yeast/events';

type MidiEvents = {
    'midi.noteOn': MidiNoteOnPayload;
    'midi.noteOff': MidiNoteOffPayload;
    'midi.pedalCc': MidiPedalCcPayload;
    'yeast.notesOff': YeastNotesOffPayload;
};

async function loadViews() {
    const eventBus = createEventBus<MidiEvents>();
    const { setWebMidiRuntimeEventBus } = await import('#/modules/MIDI/useCases');
    setWebMidiRuntimeEventBus({ eventBus });
    const { webMidiStore } = await import('#/modules/MIDI/stores');
    const { MidiDevicePicker } = await import('#/modules/AudioEngine/presentations/views');
    const { MidiStatusBadge } = await import('../MidiStatusBadge');
    return { webMidiStore, MidiDevicePicker, MidiStatusBadge };
}

describe('MIDI permission recovery', () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        localStorage.clear();
        vi.resetModules();
    });

    describe('with the Web MIDI API', () => {
        let views: Awaited<ReturnType<typeof loadViews>>;
        let requestMIDIAccess: ReturnType<typeof vi.fn>;

        beforeEach(async () => {
            const input = Object.assign(new EventTarget(), { id: 'preferred', name: 'Keyboard', manufacturer: 'Test' });
            const access = { inputs: new Map([[input.id, input]]), onstatechange: null };
            requestMIDIAccess = vi.fn().mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValue(access);
            vi.stubGlobal('navigator', { requestMIDIAccess });
            localStorage.setItem('sourdaw:midi:selectedInputId:web-midi', 'preferred');
            views = await loadViews();
        }, 30000);

        it('shows completed empty enumeration after a refused retry and later permission change', async () => {
            requestMIDIAccess
                .mockReset()
                .mockRejectedValueOnce(new Error('Permission denied'))
                .mockRejectedValueOnce(new Error('Still denied'))
                .mockResolvedValue({ inputs: new Map(), onstatechange: null });
            const { webMidiStore, MidiDevicePicker, MidiStatusBadge } = views;
            const view = render(
                <TooltipProvider>
                    <MidiDevicePicker />
                    <MidiStatusBadge />
                </TooltipProvider>
            );
            await waitFor(() => expect(webMidiStore.value?.enumerationError).toBe('Permission denied'));
            view.unmount();
            const retryView = render(
                <TooltipProvider>
                    <MidiDevicePicker />
                    <MidiStatusBadge />
                </TooltipProvider>
            );
            expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
            fireEvent.click(screen.getByLabelText('Refresh MIDI devices'));
            await waitFor(() => expect(webMidiStore.value?.enumerationError).toBe('Still denied'));
            expect(screen.getByText("Couldn't list MIDI devices. Refresh to try again.")).toBeInTheDocument();
            expect(screen.getByLabelText('MIDI input device')).toBeDisabled();
            expect(screen.getByRole('option', { name: "Couldn't list MIDI devices" })).toBeInTheDocument();
            expect(screen.queryByRole('option', { name: 'No MIDI devices found' })).not.toBeInTheDocument();
            expect(screen.getByLabelText('Refresh MIDI devices')).toBeEnabled();
            retryView.unmount();
            render(
                <TooltipProvider>
                    <MidiDevicePicker />
                    <MidiStatusBadge />
                </TooltipProvider>
            );
            expect(requestMIDIAccess).toHaveBeenCalledTimes(2);
            fireEvent.click(screen.getByLabelText('Refresh MIDI devices'));
            await waitFor(() => expect(webMidiStore.value?.enumerationError).toBeNull());
            expect(webMidiStore.value).toMatchObject({ isSupported: true, inputs: [], selectedInputId: null });
            expect(screen.getByText('No MIDI')).toBeInTheDocument();
            await waitFor(() =>
                expect(screen.getByRole('option', { name: 'No MIDI devices found' })).toBeInTheDocument()
            );
            expect(screen.queryByText("Couldn't list MIDI devices. Refresh to try again.")).not.toBeInTheDocument();
            expect(screen.queryByText('Detecting devices...')).not.toBeInTheDocument();
            expect(screen.queryByText('Detecting MIDI devices...')).not.toBeInTheDocument();
            expect(requestMIDIAccess).toHaveBeenCalledTimes(3);
            expect(localStorage.getItem('sourdaw:midi:selectedInputId:web-midi')).toBe('preferred');
        });

        it('retains an explicit retry after refusal and displays the selected device after permission changes', async () => {
            const { webMidiStore, MidiDevicePicker, MidiStatusBadge } = views;
            const view = render(
                <TooltipProvider>
                    <MidiDevicePicker />
                    <MidiStatusBadge />
                </TooltipProvider>
            );

            await waitFor(() => expect(webMidiStore.value?.enumerationError).toBe('Permission denied'));
            expect(webMidiStore.value?.isSupported).toBe(true);
            expect(screen.getByText("Couldn't list MIDI devices. Refresh to try again.")).toBeInTheDocument();
            expect(screen.getByLabelText('Refresh MIDI devices')).toBeInTheDocument();
            expect(screen.getByLabelText('MIDI inputs could not be listed: Permission denied')).toBeInTheDocument();
            expect(requestMIDIAccess).toHaveBeenCalledTimes(1);

            view.unmount();
            render(
                <TooltipProvider>
                    <MidiDevicePicker />
                    <MidiStatusBadge />
                </TooltipProvider>
            );
            expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
            fireEvent.click(screen.getByLabelText('Refresh MIDI devices'));
            await waitFor(() => expect(webMidiStore.value?.selectedInputId).toBe('preferred'));
            expect(requestMIDIAccess).toHaveBeenCalledTimes(2);
            expect(webMidiStore.value).toMatchObject({
                isSupported: true,
                enumerationError: null,
                inputs: [{ id: 'preferred', name: 'Keyboard', manufacturer: 'Test' }],
            });
            expect(screen.getByLabelText('MIDI input device')).toHaveValue('preferred');
            expect(screen.getByLabelText('MIDI: Keyboard (Test)')).toBeInTheDocument();
            expect(localStorage.getItem('sourdaw:midi:selectedInputId:web-midi')).toBe('preferred');
        });
    });

    describe('without the Web MIDI API', () => {
        let views: Awaited<ReturnType<typeof loadViews>>;
        beforeEach(async () => {
            vi.stubGlobal('navigator', {});
            views = await loadViews();
        }, 30000);

        it('shows unsupported when the browser has no MIDI API', () => {
            const { webMidiStore, MidiDevicePicker, MidiStatusBadge } = views;
            render(
                <TooltipProvider>
                    <MidiDevicePicker />
                    <MidiStatusBadge />
                </TooltipProvider>
            );
            expect(webMidiStore.value?.isSupported).toBe(false);
            expect(screen.getByText('MIDI not supported in this browser')).toBeInTheDocument();
            expect(screen.queryByLabelText('Refresh MIDI devices')).not.toBeInTheDocument();
            expect(screen.getByText('MIDI unavailable')).toBeInTheDocument();
        });
    });
});
