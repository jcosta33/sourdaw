import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentReferenceStore } from '#/modules/AiRuntime/stores';
import { clearAgentReference } from '#/modules/AiRuntime/useCases';

import { AgentWorkspace } from '../AgentWorkspace';

const mocks = vi.hoisted(() => ({
    pickFiles: vi.fn(),
    decodeAudioFileBuffer: vi.fn(),
}));

// Only the picker and the decoder are replaced: the measuring, the store and the section are real.
vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    pickFiles: mocks.pickFiles,
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    decodeAudioFileBuffer: mocks.decodeAudioFileBuffer,
}));
vi.mock('#/modules/AiRuntime/presentations/views', () => ({
    AgentRunDecisionPanel: () => <div data-testid="agent-decision-panel" />,
}));

const SAMPLE_RATE = 48_000;
const FILE_NAME = 'Reference Master.wav';

/** Four seconds of a 1 kHz stereo sine at half scale. */
function sineBuffer(): AudioBuffer {
    const length = SAMPLE_RATE * 4;
    const channel = new Float32Array(length);
    for (let frame = 0; frame < length; frame++) {
        channel[frame] = 0.5 * Math.sin((2 * Math.PI * 1_000 * frame) / SAMPLE_RATE);
    }
    return {
        sampleRate: SAMPLE_RATE,
        length,
        numberOfChannels: 2,
        duration: 4,
        getChannelData: () => channel,
    } as unknown as AudioBuffer;
}

function chooseFile(): void {
    mocks.pickFiles.mockResolvedValue([new File([new Uint8Array(8)], FILE_NAME)]);
}

beforeEach(() => {
    mocks.pickFiles.mockReset();
    mocks.decodeAudioFileBuffer.mockReset();
    act(() => {
        clearAgentReference();
    });
});

afterEach(() => {
    act(() => {
        clearAgentReference();
    });
});

describe('the reference controls of the agent workspace', () => {
    // Red when the Load control is absent, or does not show the loaded name and integrated loudness.
    it('loads a reference through the picker and decoder and shows its name and integrated loudness', async () => {
        chooseFile();
        mocks.decodeAudioFileBuffer.mockResolvedValue(sineBuffer());
        render(<AgentWorkspace />);

        expect(screen.getByText('No reference loaded')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Load reference…' }));

        const summary = await screen.findByTestId('agent-reference-summary');
        expect(summary.textContent).toMatch(/^Reference Master\.wav · -?\d+\.\d LUFS$/u);
        expect(agentReferenceStore.value?.reference?.name).toBe(FILE_NAME);
    });

    // Red when Clear reference is absent, or leaves the reference in the store.
    it('clears the loaded reference', async () => {
        chooseFile();
        mocks.decodeAudioFileBuffer.mockResolvedValue(sineBuffer());
        render(<AgentWorkspace />);
        fireEvent.click(screen.getByRole('button', { name: 'Load reference…' }));
        await screen.findByTestId('agent-reference-summary');

        fireEvent.click(screen.getByRole('button', { name: 'Clear reference' }));

        await waitFor(() => {
            expect(screen.getByText('No reference loaded')).toBeTruthy();
        });
        expect(screen.queryByTestId('agent-reference-summary')).toBeNull();
        expect(agentReferenceStore.value?.reference).toBeNull();
    });

    // Red when a file that cannot be decoded shows no alert, or leaves a reference behind.
    it('shows an alert for a decode failure and stores nothing', async () => {
        chooseFile();
        mocks.decodeAudioFileBuffer.mockRejectedValue(new Error('Unable to decode "x" — format not supported.'));
        render(<AgentWorkspace />);

        fireEvent.click(screen.getByRole('button', { name: 'Load reference…' }));

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toBe('That file could not be decoded as audio.');
        expect(screen.getByText('No reference loaded')).toBeTruthy();
        expect(agentReferenceStore.value?.reference).toBeNull();
    });

    // Red when pressing Clear while a file is still being measured lets the reference appear afterwards.
    it('keeps a reference out that was cleared while its file was still being decoded', async () => {
        let finishDecode: (buffer: AudioBuffer) => void = () => undefined;
        chooseFile();
        mocks.decodeAudioFileBuffer.mockReturnValue(
            new Promise<AudioBuffer>((resolve) => {
                finishDecode = resolve;
            })
        );
        render(<AgentWorkspace />);
        fireEvent.click(screen.getByRole('button', { name: 'Load reference…' }));
        await waitFor(() => {
            expect(mocks.decodeAudioFileBuffer).toHaveBeenCalledTimes(1);
        });

        act(() => {
            clearAgentReference();
        });
        await act(async () => {
            finishDecode(sineBuffer());
            await Promise.resolve();
        });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Load reference…' })).toBeTruthy();
        });
        expect(screen.queryByTestId('agent-reference-summary')).toBeNull();
        expect(agentReferenceStore.value?.reference).toBeNull();
    });
});
