import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';

import { MixerPanel } from '../MixerPanel';

afterEach(() => {
    cleanup();
    workspaceStore.set(defaultWorkspaceState);
});

describe('Mixer width control', () => {
    // Covers the width button identity and cycle formerly in mixerChannelWidthKeyboardTestId.
    it('cycles the real workspace width from normal to wide', () => {
        workspaceStore.set({ ...defaultWorkspaceState, channelStripWidth: 'normal' });
        render(<MixerPanel />);
        const button = screen.getByTestId('mixer-channel-width');
        expect(button).toHaveAccessibleName('Channel width: normal');
        fireEvent.click(button);
        expect(button).toHaveAccessibleName('Channel width: wide');
        expect(workspaceStore.value?.channelStripWidth).toBe('wide');
    });
});
