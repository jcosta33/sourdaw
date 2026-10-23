import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dbToGain } from '#/utils/audioLevelLaw';
import { type PromptUserOptions } from '#/utils/Notification/promptUser';

import { MasterGainControl } from '../MasterGainControl';

const promptMocks = vi.hoisted(() => ({
    promptUser: vi.fn<(_options: PromptUserOptions) => Promise<string | null>>(),
    notifyUser: vi.fn(),
    projectEpoch: 0,
}));

vi.mock('#/utils/Notification/promptUser', () => ({ promptUser: promptMocks.promptUser }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: promptMocks.notifyUser }));
vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    captureProjectTransitionAuthority: () => {
        const epoch = promptMocks.projectEpoch;
        return { isCurrent: () => promptMocks.projectEpoch === epoch };
    },
}));

function deferredPrompt(): { promise: Promise<string | null>; resolve: (value: string | null) => void } {
    let resolvePrompt = (_value: string | null): void => undefined;
    const promise = new Promise<string | null>((resolve) => {
        resolvePrompt = resolve;
    });
    return { promise, resolve: resolvePrompt };
}

function openEnterValue(): void {
    fireEvent.contextMenu(screen.getByRole('slider', { name: 'Master gain' }), { clientX: 80, clientY: 120 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Enter Value' }));
}

describe('MasterGainControl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        promptMocks.projectEpoch = 0;
        promptMocks.promptUser.mockResolvedValue(null);
    });

    it('routes entered gain to the discrete entry callback, not the fader callback', async () => {
        const onChange = vi.fn();
        const onEnterValue = vi.fn();
        promptMocks.promptUser.mockResolvedValueOnce('-6 dB');
        render(<MasterGainControl value={0.8} onChange={onChange} onEnterValue={onEnterValue} />);

        openEnterValue();

        await waitFor(() => expect(onEnterValue).toHaveBeenCalledOnce());
        expect(onEnterValue).toHaveBeenCalledWith(dbToGain(-6));
        expect(onChange).not.toHaveBeenCalled();
    });

    it.each([
        { input: '0', gain: 1 },
        { input: '-6 dB', gain: dbToGain(-6) },
        { input: '+6DB', gain: dbToGain(6) },
        { input: '.5 db', gain: dbToGain(0.5) },
        { input: '-inf', gain: 0 },
        { input: '-infinity', gain: 0 },
        { input: '-∞', gain: 0 },
    ])('accepts $input as one settled gain change', async ({ input, gain }) => {
        const onChange = vi.fn();
        promptMocks.promptUser.mockResolvedValueOnce(input);
        render(<MasterGainControl value={0.8} onChange={onChange} onEnterValue={onChange} />);

        openEnterValue();

        await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
        expect(onChange).toHaveBeenCalledWith(gain);
        expect(promptMocks.notifyUser).not.toHaveBeenCalled();
        expect(screen.getByRole('slider', { name: 'Master gain' })).toHaveFocus();
    });

    it.each(['+7', 'NaN', '+Infinity', '1 dB extra', '1e1', '- 6'])(
        'rejects nonempty invalid input %s',
        async (input) => {
            const onChange = vi.fn();
            promptMocks.promptUser.mockResolvedValueOnce(input);
            render(<MasterGainControl value={0.8} onChange={onChange} onEnterValue={onChange} />);

            openEnterValue();

            await waitFor(() => expect(promptMocks.notifyUser).toHaveBeenCalledTimes(1));
            expect(promptMocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('+6 dB'), 'error');
            expect(onChange).not.toHaveBeenCalled();
        }
    );

    it('treats cancel or blank submit as no change', async () => {
        const onChange = vi.fn();
        const prompt = deferredPrompt();
        promptMocks.promptUser.mockReturnValueOnce(prompt.promise);
        render(<MasterGainControl value={0.8} onChange={onChange} onEnterValue={onChange} />);

        openEnterValue();
        await act(async () => {
            prompt.resolve(null);
            await prompt.promise;
        });

        expect(onChange).not.toHaveBeenCalled();
        expect(promptMocks.notifyUser).not.toHaveBeenCalled();
    });

    it('preserves the exact underlying gain when the rounded initial text is submitted unchanged', async () => {
        const onChange = vi.fn();
        const value = 0.8123456789;
        const prompt = deferredPrompt();
        promptMocks.promptUser.mockReturnValueOnce(prompt.promise);
        render(<MasterGainControl value={value} onChange={onChange} onEnterValue={onChange} />);

        openEnterValue();
        const initialValue = promptMocks.promptUser.mock.calls[0]?.[0]?.initialValue;
        expect(initialValue).toBe('-1.8 dB');
        await act(async () => {
            prompt.resolve(initialValue ?? null);
            await prompt.promise;
        });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('drops a late result after project replacement', async () => {
        const onChange = vi.fn();
        const prompt = deferredPrompt();
        promptMocks.promptUser.mockReturnValueOnce(prompt.promise);
        render(<MasterGainControl value={0.8} onChange={onChange} onEnterValue={onChange} />);

        openEnterValue();
        promptMocks.projectEpoch += 1;
        await act(async () => {
            prompt.resolve('0 dB');
            await prompt.promise;
        });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('drops a late result after unmount', async () => {
        const onChange = vi.fn();
        const prompt = deferredPrompt();
        promptMocks.promptUser.mockReturnValueOnce(prompt.promise);
        const view = render(<MasterGainControl value={0.8} onChange={onChange} onEnterValue={onChange} />);

        openEnterValue();
        view.unmount();
        await act(async () => {
            prompt.resolve('0 dB');
            await prompt.promise;
        });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('lets a newer prompt win over an older pending result', async () => {
        const onChange = vi.fn();
        const oldPrompt = deferredPrompt();
        const newPrompt = deferredPrompt();
        promptMocks.promptUser.mockReturnValueOnce(oldPrompt.promise).mockReturnValueOnce(newPrompt.promise);
        render(<MasterGainControl value={0.8} onChange={onChange} onEnterValue={onChange} />);

        openEnterValue();
        openEnterValue();
        await act(async () => {
            newPrompt.resolve('-6');
            await newPrompt.promise;
        });
        await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
        await act(async () => {
            oldPrompt.resolve('0');
            await oldPrompt.promise;
        });

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(dbToGain(-6));
    });

    it.each([
        { key: 'ContextMenu', shiftKey: false },
        { key: 'F10', shiftKey: true },
    ])('opens with $key and returns focus to the real slider on Escape', ({ key, shiftKey }) => {
        const onChange = vi.fn();
        render(<MasterGainControl value={0.8} onChange={onChange} onEnterValue={onChange} />);
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        slider.focus();

        fireEvent.keyDown(slider, { key, shiftKey });
        expect(screen.getByRole('menu', { name: 'Master gain actions' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('menu', { name: 'Master gain actions' })).not.toBeInTheDocument();
        expect(slider).toHaveFocus();
        expect(onChange).not.toHaveBeenCalled();
    });
});
