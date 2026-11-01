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

function menuActions() {
    return {
        onCopyValue: vi.fn(),
        onPasteValue: vi.fn(),
        onInvalidatePendingValue: vi.fn(),
    };
}

describe('MasterGainControl', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        promptMocks.projectEpoch = 0;
        promptMocks.promptUser.mockResolvedValue(null);
    });

    it('maps unity to 70 percent while keeping keyboard writes in raw linear gain', () => {
        const onChange = vi.fn();
        render(
            <MasterGainControl
                value={1}
                onChange={onChange}
                onEnterValue={vi.fn()}
                onResetToDefault={vi.fn()}
                {...menuActions()}
            />
        );
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        const cap = slider.querySelector('[data-role="fader-cap"]') as HTMLElement;
        expect(slider).toHaveAttribute('aria-valuenow', '1');
        expect(slider).toHaveAttribute('aria-valuetext', '0.0 dB');
        expect(cap.style.bottom).toBe('calc(70% - 20px)');

        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        expect(onChange).toHaveBeenCalledWith(1.01, false);
    });

    it('routes entered gain to the discrete entry callback, not the fader callback', async () => {
        const onChange = vi.fn();
        const onEnterValue = vi.fn();
        promptMocks.promptUser.mockResolvedValueOnce('-6 dB');
        render(
            <MasterGainControl
                value={0.8}
                onChange={onChange}
                onEnterValue={onEnterValue}
                onResetToDefault={onChange}
                {...menuActions()}
            />
        );

        openEnterValue();

        await waitFor(() => expect(onEnterValue).toHaveBeenCalledOnce());
        expect(onEnterValue).toHaveBeenCalledWith(dbToGain(-6));
        expect(onChange).not.toHaveBeenCalled();
    });

    it.each([
        { input: '0', gain: 1 },
        { input: '-6 dB', gain: dbToGain(-6) },
        { input: '-60 dB', gain: dbToGain(-60) },
        { input: '+6DB', gain: dbToGain(6) },
        { input: '.5 db', gain: dbToGain(0.5) },
        { input: '-inf', gain: 0 },
        { input: '-infinity', gain: 0 },
        { input: '-∞', gain: 0 },
    ])('accepts $input as one settled gain change', async ({ input, gain }) => {
        const onChange = vi.fn();
        promptMocks.promptUser.mockResolvedValueOnce(input);
        render(
            <MasterGainControl
                value={0.8}
                onChange={onChange}
                onEnterValue={onChange}
                onResetToDefault={onChange}
                {...menuActions()}
            />
        );

        openEnterValue();

        await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
        expect(onChange).toHaveBeenCalledWith(gain);
        expect(promptMocks.notifyUser).not.toHaveBeenCalled();
        expect(screen.getByRole('slider', { name: 'Master gain' })).toHaveFocus();
    });

    it.each(['-61', '-120', '+7', 'NaN', '+Infinity', '1 dB extra', '1e1', '- 6'])(
        'rejects nonempty invalid input %s',
        async (input) => {
            const onChange = vi.fn();
            promptMocks.promptUser.mockResolvedValueOnce(input);
            render(
                <MasterGainControl
                    value={0.8}
                    onChange={onChange}
                    onEnterValue={onChange}
                    onResetToDefault={onChange}
                    {...menuActions()}
                />
            );

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
        render(
            <MasterGainControl
                value={0.8}
                onChange={onChange}
                onEnterValue={onChange}
                onResetToDefault={onChange}
                {...menuActions()}
            />
        );

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
        render(
            <MasterGainControl
                value={value}
                onChange={onChange}
                onEnterValue={onChange}
                onResetToDefault={onChange}
                {...menuActions()}
            />
        );

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
        render(
            <MasterGainControl
                value={0.8}
                onChange={onChange}
                onEnterValue={onChange}
                onResetToDefault={onChange}
                {...menuActions()}
            />
        );

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
        const view = render(
            <MasterGainControl
                value={0.8}
                onChange={onChange}
                onEnterValue={onChange}
                onResetToDefault={onChange}
                {...menuActions()}
            />
        );

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
        render(
            <MasterGainControl
                value={0.8}
                onChange={onChange}
                onEnterValue={onChange}
                onResetToDefault={onChange}
                {...menuActions()}
            />
        );

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

    it('focuses the first action and moves to Enter Value with ArrowDown', () => {
        const onReset = vi.fn();
        render(
            <MasterGainControl
                value={0.8}
                onChange={vi.fn()}
                onEnterValue={vi.fn()}
                onResetToDefault={onReset}
                {...menuActions()}
            />
        );
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        slider.focus();
        fireEvent.keyDown(slider, { key: 'ContextMenu' });
        const reset = screen.getByRole('menuitem', { name: 'Reset to Default' });
        const enter = screen.getByRole('menuitem', { name: 'Enter Value' });
        const copy = screen.getByRole('menuitem', { name: 'Copy Value' });
        const paste = screen.getByRole('menuitem', { name: 'Paste Value' });

        expect(reset).toHaveFocus();
        fireEvent.keyDown(reset, { key: 'ArrowDown' });
        expect(enter).toHaveFocus();
        fireEvent.keyDown(enter, { key: 'ArrowDown' });
        expect(copy).toHaveFocus();
        fireEvent.keyDown(copy, { key: 'ArrowDown' });
        expect(paste).toHaveFocus();
        fireEvent.keyDown(paste, { key: 'ArrowDown' });
        expect(reset).toHaveFocus();
        fireEvent.keyDown(reset, { key: 'ArrowUp' });
        expect(paste).toHaveFocus();
        fireEvent.keyDown(paste, { key: 'Home' });
        expect(reset).toHaveFocus();
        fireEvent.keyDown(reset, { key: 'End' });
        expect(paste).toHaveFocus();
        // Native buttons own activation. Keydown must not invoke an extra action.
        fireEvent.keyDown(enter, { key: 'Enter' });
        fireEvent.keyDown(enter, { key: ' ' });
        expect(onReset).not.toHaveBeenCalled();
        expect(promptMocks.promptUser).not.toHaveBeenCalled();
        fireEvent.click(enter);
        expect(promptMocks.promptUser).toHaveBeenCalledOnce();
        expect(onReset).not.toHaveBeenCalled();
    });

    it('routes Copy Value and Paste Value through dedicated callbacks', () => {
        const onCopyValue = vi.fn();
        const onPasteValue = vi.fn();
        const onInvalidatePendingValue = vi.fn();
        render(
            <MasterGainControl
                value={0.8}
                onChange={vi.fn()}
                onEnterValue={vi.fn()}
                onResetToDefault={vi.fn()}
                onCopyValue={onCopyValue}
                onPasteValue={onPasteValue}
                onInvalidatePendingValue={onInvalidatePendingValue}
            />
        );
        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Master gain' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Value' }));
        expect(onCopyValue).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();

        fireEvent.contextMenu(screen.getByRole('slider', { name: 'Master gain' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Paste Value' }));
        expect(onPasteValue).toHaveBeenCalledOnce();
        expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it.each(['Reset to Default', 'Copy Value', 'Paste Value'])(
        'keeps a %s click from reaching the enclosing master strip',
        (name) => {
            const onStripClick = vi.fn();
            render(
                // The master strip selects its track on click; the menu sits inside it in the React tree.
                <div role="presentation" onClick={onStripClick}>
                    <MasterGainControl
                        value={0.8}
                        onChange={vi.fn()}
                        onEnterValue={vi.fn()}
                        onResetToDefault={vi.fn()}
                        {...menuActions()}
                    />
                </div>
            );
            fireEvent.contextMenu(screen.getByRole('slider', { name: 'Master gain' }));

            fireEvent.click(screen.getByRole('menuitem', { name }));

            expect(onStripClick).not.toHaveBeenCalled();
        }
    );

    it.each([
        { key: 'ContextMenu', shiftKey: false },
        { key: 'F10', shiftKey: true },
    ])('opens with $key and returns focus to the real slider on Escape', ({ key, shiftKey }) => {
        const onChange = vi.fn();
        render(
            <MasterGainControl
                value={0.8}
                onChange={onChange}
                onEnterValue={onChange}
                onResetToDefault={onChange}
                {...menuActions()}
            />
        );
        const slider = screen.getByRole('slider', { name: 'Master gain' });
        slider.focus();

        fireEvent.keyDown(slider, { key, shiftKey });
        expect(screen.getByRole('menuitem', { name: 'Reset to Default' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('menu', { name: 'Master gain actions' })).not.toBeInTheDocument();
        expect(slider).toHaveFocus();
        expect(onChange).not.toHaveBeenCalled();
    });
});
