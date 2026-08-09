import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, undo } from '#/modules/Command/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { defaultTransportState, getTransportHandlers } from '#/modules/Transport/useCases';

import { TransportControls } from '../TransportControls';

const defaultProps = {
    isPlaying: false,
    isRecording: false,
    isAudioRecording: false,
    isLooping: false,
    overdubEnabled: false,
    showOverdub: false,
    anyTrackArmed: false,
    metronomeEnabled: false,
    metronomeVolume: 0.8,
    punchInEnabled: false,
    countInEnabled: false,
    countInBars: 1,
};

function renderControls(props: Partial<typeof defaultProps> = {}): void {
    render(
        <TooltipProvider delayDuration={0}>
            <TransportControls {...defaultProps} {...props} />
        </TooltipProvider>
    );
}

describe('TransportControls punch command integration', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        transportStore.set({ ...defaultTransportState, punchInEnabled: false });
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
    });

    it('creates one undoable action when clicked while stopped', async () => {
        renderControls();

        fireEvent.click(screen.getByLabelText('Punch in/out'));

        await waitFor(() => {
            expect(transportStore.value?.punchInEnabled).toBe(true);
            expect(undoStore.value?.past).toHaveLength(1);
        });
        await undo();
        expect(transportStore.value?.punchInEnabled).toBe(false);
    });

    it('changes neither project state nor history when clicked while busy', async () => {
        transportStore.set({ ...transportStore.value!, isPlaying: true });
        renderControls({ isPlaying: true });
        const punch = screen.getByLabelText('Punch in/out');

        expect(punch).toBeDisabled();
        fireEvent.click(punch);
        await Promise.resolve();

        expect(transportStore.value?.punchInEnabled).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(0);
    });
});
