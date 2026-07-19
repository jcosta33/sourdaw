import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { useWorkspaceState } from '../useWorkspaceState';

import type { WorkspaceState } from '#/modules/WorkspaceShell/stores';

const mocks = vi.hoisted(() => ({
    useStore: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));

vi.mock('#/modules/WorkspaceShell/stores', () => ({
    workspaceStore: {},
    defaultWorkspaceState: {},
}));

const makeState = (channelStripWidth: WorkspaceState['channelStripWidth']): WorkspaceState =>
    ({ channelStripWidth }) as WorkspaceState;

describe('useWorkspaceState', () => {
    it('passes through the narrow channel-strip width read from the Workspace store', () => {
        mocks.useStore.mockReturnValue(makeState('narrow'));

        const { result } = renderHook(() => useWorkspaceState());

        expect(result.current.channelStripWidth).toBe('narrow');
    });

    it('passes through the wide channel-strip width read from the Workspace store', () => {
        mocks.useStore.mockReturnValue(makeState('wide'));

        const { result } = renderHook(() => useWorkspaceState());

        expect(result.current.channelStripWidth).toBe('wide');
    });
});
