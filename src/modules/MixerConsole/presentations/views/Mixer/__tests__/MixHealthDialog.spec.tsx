import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MixHealthDialog } from '../MixHealthDialog';

const mocks = vi.hoisted(() => ({
    mixHealthAnalysis: vi.fn<(onToken: (text: string) => void) => Promise<void>>(),
    streamCloudChatCompletion:
        vi.fn<(messages: Array<{ role: string; content: string }>, onToken: (text: string) => void) => Promise<void>>(),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    mixHealthAnalysis: mocks.mixHealthAnalysis,
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

describe('MixHealthDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.mixHealthAnalysis.mockResolvedValue(undefined);
        mocks.streamCloudChatCompletion.mockResolvedValue(undefined);
    });

    it('does not run analysis or render dialog content while closed', () => {
        render(<MixHealthDialog open={false} onOpenChange={vi.fn()} />);

        expect(mocks.mixHealthAnalysis).not.toHaveBeenCalled();
        expect(screen.queryByText('AI Music Mentor: Mix Health')).not.toBeInTheDocument();
    });

    it('starts analysis and shows the loading state until it resolves', async () => {
        let resolveAnalysis: () => void = () => undefined;
        mocks.mixHealthAnalysis.mockImplementation(
            (onToken) =>
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

        resolveAnalysis();
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
        mocks.mixHealthAnalysis.mockImplementation(async (onToken) => {
            onToken('Technical report body.');
        });
        mocks.streamCloudChatCompletion.mockImplementation(async (_messages, onToken) => {
            onToken('Simple explanation.');
        });

        render(<MixHealthDialog open onOpenChange={vi.fn()} />);
        await screen.findByText('Technical report body.');

        fireEvent.click(screen.getByRole('button', { name: "Explain Like I'm 5" }));

        expect(mocks.streamCloudChatCompletion).toHaveBeenCalledTimes(1);
        const call = mocks.streamCloudChatCompletion.mock.calls[0];
        if (!call) {
            throw new Error('streamCloudChatCompletion was not called');
        }
        const [messages] = call;
        expect(messages[0]).toEqual({ role: 'system', content: 'You are a patient music teacher for beginners.' });
        expect(messages[1]?.content).toContain('Technical report body.');

        expect(await screen.findByText('Simple explanation.')).toBeInTheDocument();
        expect(screen.getByText('ELI5 Translation')).toBeInTheDocument();
    });

    it('disables the ELI5 button until a report exists, and Close notifies the caller', async () => {
        mocks.mixHealthAnalysis.mockImplementation(async (onToken) => {
            onToken('Report ready.');
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
});
