import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { IrBrowser } from '../IrBrowser';

const mocks = vi.hoisted(() => ({
    loggerWarn: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn },
}));

function getDropZone(): HTMLElement {
    const dropLabel = screen.getByText(/drop wav/i);
    const dropZone = dropLabel.parentElement?.parentElement;
    if (!dropZone) {
        throw new Error('IR drop zone is not rendered');
    }
    return dropZone;
}

function makeFile(name: string, type = 'audio/wav'): File {
    return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('IrBrowser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render', () => {
        render(<IrBrowser onFileDrop={vi.fn()} onIrLoaded={vi.fn()} />);
        expect(screen.getByText(/drop wav/i)).toBeTruthy();
    });

    it('passes a supported file to the decoder and renders the decoded IR', async () => {
        const data = new Float32Array([0.25, -0.25]);
        const onFileDrop = vi.fn(() => Promise.resolve({ data, channels: 1, sampleRate: 44_100, waveform: [0.25] }));
        const onIrLoaded = vi.fn();
        const file = makeFile('hall.wav');
        render(<IrBrowser onFileDrop={onFileDrop} onIrLoaded={onIrLoaded} />);
        fireEvent.drop(getDropZone(), { dataTransfer: { files: [file] } });
        await waitFor(() => expect(onIrLoaded).toHaveBeenCalledWith(data, 1, 44_100));
        expect(onFileDrop).toHaveBeenCalledWith(file);
        expect(screen.getByText('hall.wav')).toBeTruthy();
    });

    it('logs a decode failure without reporting an IR load', async () => {
        const error = new Error('invalid impulse response');
        const onFileDrop = vi.fn(() => Promise.reject(error));
        const onIrLoaded = vi.fn();
        render(<IrBrowser onFileDrop={onFileDrop} onIrLoaded={onIrLoaded} />);
        fireEvent.drop(getDropZone(), { dataTransfer: { files: [makeFile('broken.wav')] } });
        await waitFor(() =>
            expect(mocks.loggerWarn).toHaveBeenCalledWith('[ProofChamber] Failed to decode IR:', error)
        );
        expect(onIrLoaded).not.toHaveBeenCalled();
    });

    it('ignores unsupported files before invoking the decoder', () => {
        const onFileDrop = vi.fn();
        render(<IrBrowser onFileDrop={onFileDrop} onIrLoaded={vi.fn()} />);
        fireEvent.drop(getDropZone(), { dataTransfer: { files: [makeFile('notes.txt', 'text/plain')] } });
        expect(onFileDrop).not.toHaveBeenCalled();
    });
});

describe('IrBrowser — drop interaction state', () => {
    it('toggles drag-over state on dragEnter and dragLeave', () => {
        render(<IrBrowser onFileDrop={vi.fn()} onIrLoaded={vi.fn()} />);
        const dropZone = getDropZone();
        fireEvent.dragOver(dropZone, { preventDefault: () => undefined });
        // After dragOver the zone shows the dragging style
        expect(dropZone.getAttribute('class')).toContain('accent-cyan');
        fireEvent.dragLeave(dropZone);
        // After dragLeave the dragging style is removed
        expect(dropZone.getAttribute('class')).not.toContain('accent-cyan');
    });

    it('accepts AIFF files by extension when mime type is empty', async () => {
        const onFileDrop = vi.fn(() =>
            Promise.resolve({
                data: new Float32Array([0.1]),
                channels: 2,
                sampleRate: 48_000,
                waveform: [0.5],
            })
        );
        const onIrLoaded = vi.fn();
        render(<IrBrowser onFileDrop={onFileDrop} onIrLoaded={onIrLoaded} />);
        // File with empty type but .aiff extension should be accepted
        const file = makeFile('plate.aiff', '');
        fireEvent.drop(getDropZone(), { dataTransfer: { files: [file] } });
        await waitFor(() => expect(onFileDrop).toHaveBeenCalledWith(file));
    });

    it('renders a canvas waveform after successful IR load', async () => {
        const data = new Float32Array([0.25]);
        const onFileDrop = vi.fn(() =>
            Promise.resolve({ data, channels: 1, sampleRate: 44_100, waveform: [0.5, 0.3, 0.8] })
        );
        const { container } = render(<IrBrowser onFileDrop={onFileDrop} onIrLoaded={vi.fn()} />);
        fireEvent.drop(getDropZone(), { dataTransfer: { files: [makeFile('ir.wav')] } });
        await waitFor(() => {
            expect(container.querySelector('canvas')).toBeTruthy();
        });
    });
});
