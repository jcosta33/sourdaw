import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MixHealthDialog } from '../MixHealthDialog';

type HostedTextResult = {
    status: 'complete' | 'partial' | 'failed' | 'cancelled' | 'unavailable';
    failure: { safeMessage: string } | null;
};

const mocks = vi.hoisted(() => ({
    mixHealthAnalysis: vi.fn<(input: { onToken: (text: string) => void; signal?: AbortSignal }) => Promise<void>>(),
    streamHostedModelText:
        vi.fn<
            (input: {
                messages: Array<{ role: string; content: string }>;
                onToken: (text: string) => void;
                signal?: AbortSignal;
            }) => Promise<HostedTextResult>
        >(),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    mixHealthAnalysis: mocks.mixHealthAnalysis,
    streamHostedModelText: mocks.streamHostedModelText,
}));

describe('MixHealthDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mixHealthAnalysis.mockResolvedValue(undefined);
        mocks.streamHostedModelText.mockResolvedValue({ status: 'complete', failure: null });
    });

    it('does not run analysis or render dialog content while closed', () => {
        render(<MixHealthDialog open={false} onOpenChange={vi.fn()} />);

        expect(mocks.mixHealthAnalysis).not.toHaveBeenCalled();
        expect(screen.queryByText('AI Music Mentor: Mix Health')).not.toBeInTheDocument();
    });

    it('starts analysis and shows the loading state until it resolves', async () => {
        let resolveAnalysis: () => void = () => undefined;
        mocks.mixHealthAnalysis.mockImplementation(
            ({ onToken }) =>
                new Promise<void>((resolve) => {
                    resolveAnalysis = () => {
                        onToken('Mix looks balanced.');
                        resolve();
                    };
                })
        );

        render(<MixHealthDialog open onOpenChange={vi.fn()} />);

        expect(mocks.mixHealthAnalysis).toHaveBeenCalledTimes(1);
        expect(screen.getByText('Mentor is thinking...')).toBeInTheDocument();
        expect(screen.getByText('Generating a fresh read on the current mix')).toBeInTheDocument();

        await act(async () => {
            resolveAnalysis();
            await Promise.resolve();
        });
        expect(await screen.findByText('Mix looks balanced.')).toBeInTheDocument();
        expect(screen.queryByText('Mentor is thinking...')).not.toBeInTheDocument();
        expect(screen.getByText('Cloud mentor report')).toBeInTheDocument();
    });

    it('shows an error message when analysis fails', async () => {
        mocks.mixHealthAnalysis.mockRejectedValue(new Error('network down'));

        render(<MixHealthDialog open onOpenChange={vi.fn()} />);

        expect(
            await screen.findByText('Error generating mix health report. Make sure Cloud AI is connected.')
        ).toBeInTheDocument();
        expect(screen.queryByText('Mentor is thinking...')).not.toBeInTheDocument();
    });

    it('requests an ELI5 explanation of the current report with the expected prompt', async () => {
        mocks.mixHealthAnalysis.mockImplementation(({ onToken }) => {
            onToken('Technical report body.');
            return Promise.resolve();
        });
        mocks.streamHostedModelText.mockImplementation((input) => {
            input.onToken('Simple explanation.');
            return Promise.resolve({ status: 'complete', failure: null });
        });

        render(<MixHealthDialog open onOpenChange={vi.fn()} />);
        await screen.findByText('Technical report body.');

        fireEvent.click(screen.getByRole('button', { name: "Explain Like I'm 5" }));

        expect(mocks.streamHostedModelText).toHaveBeenCalledTimes(1);
        const call = mocks.streamHostedModelText.mock.calls[0];
        if (!call) {
            throw new Error('streamHostedModelText was not called');
        }
        const [{ messages }] = call;
        expect(messages[0]).toEqual({ role: 'system', content: 'You are a patient music teacher for beginners.' });
        expect(messages[1]?.content).toContain('Technical report body.');

        expect(await screen.findByText('Simple explanation.')).toBeInTheDocument();
        expect(screen.getByText('ELI5 Translation')).toBeInTheDocument();
    });

    it('marks a token-limited ELI5 response as incomplete', async () => {
        mocks.mixHealthAnalysis.mockImplementation(({ onToken }) => {
            onToken('Technical report body.');
            return Promise.resolve();
        });
        mocks.streamHostedModelText.mockImplementation((input) => {
            input.onToken('Partial explanation.');
            return Promise.resolve({
                status: 'partial',
                failure: { safeMessage: 'The model provider stopped at its output limit.' },
            });
        });

        render(<MixHealthDialog open onOpenChange={vi.fn()} />);
        await screen.findByText('Technical report body.');

        fireEvent.click(screen.getByRole('button', { name: "Explain Like I'm 5" }));

        expect(await screen.findByText(/Partial explanation/)).toBeInTheDocument();
        expect(await screen.findByText(/stopped at its output limit/)).toBeInTheDocument();
    });

    it('disables the ELI5 button until a report exists, and Close notifies the caller', async () => {
        mocks.mixHealthAnalysis.mockImplementation(({ onToken }) => {
            onToken('Report ready.');
            return Promise.resolve();
        });
        const onOpenChange = vi.fn();

        render(<MixHealthDialog open onOpenChange={onOpenChange} />);

        const eli5Button = screen.getByRole('button', { name: "Explain Like I'm 5" });
        expect(eli5Button).toBeDisabled();
        await waitFor(() => expect(eli5Button).not.toBeDisabled());

        const closeButtons = screen.getAllByRole('button', { name: 'Close' });
        const footerCloseButton = closeButtons.find((button) => button.getAttribute('data-slot') !== 'dialog-close');
        if (!footerCloseButton) {
            throw new Error('footer Close button not found');
        }

        fireEvent.click(footerCloseButton);
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('aborts the active analysis when the dialog closes', () => {
        let analysisSignal: AbortSignal | undefined;
        mocks.mixHealthAnalysis.mockImplementation(
            ({ signal }) =>
                new Promise<void>(() => {
                    analysisSignal = signal;
                })
        );
        const { rerender } = render(<MixHealthDialog open onOpenChange={vi.fn()} />);

        rerender(<MixHealthDialog open={false} onOpenChange={vi.fn()} />);

        expect(analysisSignal?.aborted).toBe(true);
    });

    it('aborts an active ELI5 stream when the dialog closes', async () => {
        mocks.mixHealthAnalysis.mockImplementation(({ onToken }) => {
            onToken('Report ready.');
            return Promise.resolve();
        });
        let eli5Signal: AbortSignal | undefined;
        mocks.streamHostedModelText.mockImplementation(
            (input) =>
                new Promise<HostedTextResult>(() => {
                    eli5Signal = input.signal;
                })
        );
        const { rerender } = render(<MixHealthDialog open onOpenChange={vi.fn()} />);
        await screen.findByText('Report ready.');
        fireEvent.click(screen.getByRole('button', { name: "Explain Like I'm 5" }));

        rerender(<MixHealthDialog open={false} onOpenChange={vi.fn()} />);

        expect(eli5Signal?.aborted).toBe(true);
    });
});
