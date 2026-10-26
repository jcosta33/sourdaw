import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { PromptDialog } from '#/infra/dialogService/PromptDialog';
import { createEventBus } from '#/infra/events/createEventBus';
import { dbToGain } from '#/utils/audioLevelLaw';
import { type PromptPayload, type NotifyPayload, type ConfirmPayload } from '#/utils/Notification/notificationEventBus';
import { promptUser } from '#/utils/Notification/promptUser';

import { MasterGainControl } from '../MasterGainControl';

vi.mock('#/modules/Project/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Project/useCases')>()),
    captureProjectTransitionAuthority: () => ({ isCurrent: () => true }),
}));

function Control({ onEnterValue }: { onEnterValue: (value: number) => void }): React.ReactElement {
    return (
        <MasterGainControl
            value={0.8}
            onChange={vi.fn()}
            onEnterValue={onEnterValue}
            onResetToDefault={vi.fn()}
            onCopyValue={vi.fn()}
            onPasteValue={vi.fn()}
            onInvalidatePendingValue={vi.fn()}
        />
    );
}

function openKeyboardEntry(key = 'ContextMenu'): void {
    const slider = screen.getByRole('slider', { name: 'Master gain' });
    slider.focus();
    fireEvent.keyDown(slider, { key, shiftKey: key === 'F10' });
    const reset = screen.getByRole('menuitem', { name: 'Reset to Default' });
    expect(reset).toHaveFocus();
    fireEvent.keyDown(reset, { key: 'ArrowDown' });
    const enter = screen.getByRole('menuitem', { name: 'Enter Value' });
    expect(enter).toHaveFocus();
    // jsdom does not synthesize browser Enter/Space button clicks.
    fireEvent.click(enter);
    expect(screen.getByRole('dialog', { name: 'Enter Master Gain' })).toBeInTheDocument();
}

describe('Master gain real prompt focus', () => {
    beforeEach(() => {
        const bus = createEventBus<{
            'ui.prompt': PromptPayload;
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
        }>();
        injectDependencies(promptUser, { eventBus: bus });
    });
    afterEach(() => vi.restoreAllMocks());

    it.each(['Enter', 'Set Gain', 'Escape', 'Cancel'])(
        'returns focus to the stable fader after real dialog %s',
        async (close) => {
            const onEnterValue = vi.fn();
            render(
                <>
                    <Control onEnterValue={onEnterValue} />
                    <PromptDialog />
                </>
            );
            const slider = screen.getByRole('slider', { name: 'Master gain' });
            openKeyboardEntry(close === 'Cancel' ? 'F10' : 'ContextMenu');
            const input = screen.getByRole('textbox', { name: 'Enter Master Gain' });
            fireEvent.change(input, { target: { value: '-6 dB' } });
            if (close === 'Enter' || close === 'Escape') {
                fireEvent.keyDown(input, { key: close });
            } else {
                fireEvent.click(screen.getByRole('button', { name: close }));
            }
            await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
            await waitFor(() => expect(slider).toHaveFocus());
            if (close === 'Escape' || close === 'Cancel') {
                expect(onEnterValue).not.toHaveBeenCalled();
            } else {
                expect(onEnterValue).toHaveBeenCalledExactlyOnceWith(dbToGain(-6));
            }
        }
    );

    it.each(['outside focus', 'new prompt', 'unmount'])(
        'does not restore an obsolete focus request after %s',
        async (replacement) => {
            const frames = new Map<number, FrameRequestCallback>();
            let frameId = 0;
            vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
                frames.set(++frameId, callback);
                return frameId;
            });
            vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
                frames.delete(id);
            });
            const onEnterValue = vi.fn();
            const view = render(
                <>
                    <Control onEnterValue={onEnterValue} />
                    <PromptDialog />
                    <button>Other control</button>
                </>
            );
            openKeyboardEntry();
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
            await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
            if (replacement === 'outside focus') {
                screen.getByRole('button', { name: 'Other control' }).focus();
            } else if (replacement === 'new prompt') {
                openKeyboardEntry();
            } else {
                view.rerender(
                    <>
                        <PromptDialog />
                        <button>Other control</button>
                    </>
                );
                screen.getByRole('button', { name: 'Other control' }).focus();
            }
            act(() => {
                for (const callback of frames.values()) {
                    callback(performance.now());
                }
                frames.clear();
            });
            if (replacement === 'new prompt') {
                expect(screen.getByRole('textbox', { name: 'Enter Master Gain' })).toHaveFocus();
            } else {
                expect(screen.getByRole('button', { name: 'Other control' })).toHaveFocus();
            }
            expect(onEnterValue).not.toHaveBeenCalled();
        }
    );
});
