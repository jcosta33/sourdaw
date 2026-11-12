import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MixHealthDialog } from '../MixHealthDialog';

const mocks = vi.hoisted(() => ({
    mixHealthAnalysis: vi.fn<(input: { onToken: (text: string) => void; signal?: AbortSignal }) => Promise<void>>(),
    explainMixHealthReport:
        vi.fn<(input: { report: string; onToken: (text: string) => void; signal?: AbortSignal }) => Promise<void>>(),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    explainMixHealthReport: mocks.explainMixHealthReport,
    mixHealthAnalysis: mocks.mixHealthAnalysis,
}));

const NEEDS_MODEL_MESSAGE =
    'Mix Health needs an AI model. Load the local WebLLM model in Settings > AI, or select the hosted provider there to send this analysis remotely.';

describe('MixHealthDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mixHealthAnalysis.mockResolvedValue(undefined);
        mocks.explainMixHealthReport.mockResolvedValue(undefined);
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
        expect(screen.getByText('Mentor report')).toBeInTheDocument();
    });

    it('shows why the analysis could not run and how to proceed', async () => {
        mocks.mixHealthAnalysis.mockRejectedValue(new Error(NEEDS_MODEL_MESSAGE));

        render(<MixHealthDialog open onOpenChange={vi.fn()} />);

        expect(await screen.findByText(NEEDS_MODEL_MESSAGE)).toBeInTheDocument();
        expect(screen.queryByText(/Cloud AI/)).not.toBeInTheDocument();
        expect(screen.queryByText('Mentor is thinking...')).not.toBeInTheDocument();
    });

    it('requests an ELI5 explanation of the current report', async () => {
        mocks.mixHealthAnalysis.mockImplementation(({ onToken }) => {
            onToken('Technical report body.');
            return Promise.resolve();
        });
        mocks.explainMixHealthReport.mockImplementation((input) => {
            input.onToken('Simple explanation.');
            return Promise.resolve();
        });

        render(<MixHealthDialog open onOpenChange={vi.fn()} />);
        await screen.findByText('Technical report body.');

        fireEvent.click(screen.getByRole('button', { name: "Explain Like I'm 5" }));

        expect(mocks.explainMixHealthReport).toHaveBeenCalledTimes(1);
        expect(mocks.explainMixHealthReport.mock.calls[0]?.[0].report).toBe('Technical report body.');

        expect(await screen.findByText('Simple explanation.')).toBeInTheDocument();
        expect(screen.getByText('ELI5 Translation')).toBeInTheDocument();
    });

    it('marks a token-limited ELI5 response as incomplete', async () => {
        mocks.mixHealthAnalysis.mockImplementation(({ onToken }) => {
            onToken('Technical report body.');
            return Promise.resolve();
        });
        mocks.explainMixHealthReport.mockImplementation((input) => {
            input.onToken('Partial explanation.');
            return Promise.reject(new Error('The model provider stopped at its output limit.'));
        });

        render(<MixHealthDialog open onOpenChange={vi.fn()} />);
        await screen.findByText('Technical report body.');

        fireEvent.click(screen.getByRole('button', { name: "Explain Like I'm 5" }));

        expect(await screen.findByText(/Partial explanation/)).toBeInTheDocument();
        expect(await screen.findByText(/stopped at its output limit/)).toBeInTheDocument();
    });

    it('shows why the ELI5 explanation could not run', async () => {
        mocks.mixHealthAnalysis.mockImplementation(({ onToken }) => {
            onToken('Technical report body.');
            return Promise.resolve();
        });
        mocks.explainMixHealthReport.mockRejectedValue(new Error(NEEDS_MODEL_MESSAGE));

        render(<MixHealthDialog open onOpenChange={vi.fn()} />);
        await screen.findByText('Technical report body.');

        fireEvent.click(screen.getByRole('button', { name: "Explain Like I'm 5" }));

        expect(await screen.findByText((content) => content.includes(NEEDS_MODEL_MESSAGE))).toBeInTheDocument();
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

    it('renders the report without image elements and with safe links only', async () => {
        mocks.mixHealthAnalysis.mockImplementation(({ onToken }) => {
            onToken(
                '![tracker](https://example.invalid/leak)\n\n[unsafe](javascript:alert(1))\n\n[docs](https://example.com/guide)'
            );
            return Promise.resolve();
        });

        render(<MixHealthDialog open onOpenChange={vi.fn()} />);
        await screen.findByText('docs');

        expect(document.body.querySelector('img')).toBeNull();
        const unsafeLink = screen.getByText('unsafe').closest('a');
        expect(unsafeLink?.getAttribute('href') ?? '').not.toContain('javascript:');
        expect(screen.getByText('docs').closest('a')?.getAttribute('href')).toBe('https://example.com/guide');
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
        mocks.explainMixHealthReport.mockImplementation(
            (input) =>
                new Promise<void>(() => {
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
