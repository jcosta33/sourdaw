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
        expect(screen.getByText(/drop wav/i)).toBeInTheDocument();
    });

    it('passes a supported file to the decoder and renders the decoded IR', async () => {
        const data = new Float32Array([0.25, -0.25]);
        const onFileDrop = vi.fn(() =>
            Promise.resolve({
                data,
                channels: 1,
                sampleRate: 44_100,
                waveform: [0.25],
            })
        );
        const onIrLoaded = vi.fn();
        const file = makeFile('hall.wav');

        render(<IrBrowser onFileDrop={onFileDrop} onIrLoaded={onIrLoaded} />);
        fireEvent.drop(getDropZone(), { dataTransfer: { files: [file] } });

        await waitFor(() => expect(onIrLoaded).toHaveBeenCalledWith(data, 1, 44_100));
        expect(onFileDrop).toHaveBeenCalledWith(file);
        expect(screen.getByText('hall.wav')).toBeInTheDocument();
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
