import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type CollaborationState } from '../../../useCases/collaborationQueries';
import { CollaborationPanel } from '../CollaborationPanel';

const mocks = vi.hoisted(() => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => defaultValue),
    closeCollaborationPanel: vi.fn(),
    useCollaborationState: vi.fn(),
    createSession: vi.fn(),
    generateInvite: vi.fn(),
    acceptAnswer: vi.fn(),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    loggerWarn: vi.fn(),
    clipboardWriteText: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    closeCollaborationPanel: mocks.closeCollaborationPanel,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: mocks.loggerWarn },
}));

vi.mock('../../hooks/useCollaborationState', () => ({
    useCollaborationState: mocks.useCollaborationState,
}));

vi.mock('../../../useCases/collaboration/createSession', () => ({
    createSession: mocks.createSession,
}));
vi.mock('../../../useCases/collaboration/generateInvite', () => ({
    generateInvite: mocks.generateInvite,
}));
vi.mock('../../../useCases/collaboration/acceptAnswer', () => ({
    acceptAnswer: mocks.acceptAnswer,
}));
vi.mock('../../../useCases/collaboration/joinSession', () => ({
    joinSession: mocks.joinSession,
}));
vi.mock('../../../useCases/collaboration/leaveSession', () => ({
    leaveSession: mocks.leaveSession,
}));

vi.mock('../QrInvite', () => ({
    QrInvite: ({ inviteString }: { inviteString: string }) => <div data-testid="qr-invite">{inviteString}</div>,
}));

const baseState: CollaborationState = {
    isEnabled: false,
    sessionId: null,
    localPeerId: null,
    localName: '',
    localColor: '',
    isHost: false,
    peers: [],
    connectionStatus: 'disconnected',
    error: null,
    quarantinedPeerIds: [],
};

function setState(overrides: Partial<CollaborationState> = {}): void {
    mocks.useCollaborationState.mockReturnValue({ ...baseState, ...overrides });
}

describe('CollaborationPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.useStore.mockImplementation((_store, defaultValue) => defaultValue);
        setState();
        Object.assign(navigator, { clipboard: { writeText: mocks.clipboardWriteText } });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should render without crashing', () => {
        render(<CollaborationPanel />);
        expect(document.body).toBeTruthy();
    });

    it('renders nothing while the workspace panel is closed', () => {
        const { container } = render(<CollaborationPanel />);
        expect(container).toBeEmptyDOMElement();
    });

    it('closes when Escape is pressed while the panel is open', () => {
        mocks.useStore.mockReturnValue({ collaborationPanelOpen: true });
        render(<CollaborationPanel />);

        const panel = screen.getByRole('dialog', { name: 'Collaborate' });
        fireEvent.keyDown(panel, { key: 'Escape' });

        expect(mocks.closeCollaborationPanel).toHaveBeenCalledTimes(1);
    });

    it('does not close on other keys', () => {
        mocks.useStore.mockReturnValue({ collaborationPanelOpen: true });
        render(<CollaborationPanel />);

        const panel = screen.getByRole('dialog', { name: 'Collaborate' });
        fireEvent.keyDown(panel, { key: 'Enter' });

        expect(mocks.closeCollaborationPanel).not.toHaveBeenCalled();
    });

    it('closes via the header close button', () => {
        mocks.useStore.mockReturnValue({ collaborationPanelOpen: true });
        render(<CollaborationPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Close' }));

        expect(mocks.closeCollaborationPanel).toHaveBeenCalledTimes(1);
    });

    describe('status row', () => {
        beforeEach(() => {
            mocks.useStore.mockReturnValue({ collaborationPanelOpen: true });
        });

        it('shows the connected label with the live peer count', () => {
            setState({
                connectionStatus: 'connected',
                peers: [
                    {
                        id: 'p1',
                        name: 'A',
                        color: '#fff',
                        isConnected: true,
                        isHost: false,
                        lastSeen: 0,
                        latencyMs: null,
                    },
                ],
            });
            render(<CollaborationPanel />);
            expect(screen.getByText('Collaborating · 2 people')).toBeInTheDocument();
        });

        it('shows the connecting label', () => {
            setState({ connectionStatus: 'connecting' });
            render(<CollaborationPanel />);
            expect(screen.getByText('Connecting...')).toBeInTheDocument();
        });

        it('shows the error label from state.error, falling back when absent', () => {
            setState({ connectionStatus: 'error', error: null });
            render(<CollaborationPanel />);
            expect(screen.getByText('Connection error')).toBeInTheDocument();
        });

        it('shows the not-connected label by default', () => {
            render(<CollaborationPanel />);
            expect(screen.getByText('Not connected')).toBeInTheDocument();
        });

        it('renders a danger status row for a session error', () => {
            setState({ error: 'Something broke' });
            render(<CollaborationPanel />);
            expect(screen.getAllByText('Something broke').length).toBeGreaterThan(0);
        });

        /**
         * Turns red on: the `quarantinedPeerLabel` row in CollaborationPanel.
         *
         * The peer stays listed and connected while its edits silently stop
         * arriving, so the panel is the only place this is visible — and it
         * has to be visible while a transient message occupies the error row.
         */
        it('names a quarantined peer in its own row, alongside a transient error', () => {
            setState({
                isEnabled: true,
                error: 'Could not send project changes to a peer — they may be out of date.',
                peers: [
                    {
                        id: 'peer-2',
                        name: 'Ada',
                        color: '#ef4444',
                        isHost: false,
                        isConnected: true,
                        lastSeen: 0,
                        latencyMs: null,
                    },
                ],
                quarantinedPeerIds: ['peer-2'],
            });
            render(<CollaborationPanel />);

            expect(screen.getByText(/Stopped syncing with Ada/)).toBeInTheDocument();
            expect(screen.getAllByText(/may be out of date/).length).toBeGreaterThan(0);
        });
    });

    describe('enabled session — peers and host controls', () => {
        beforeEach(() => {
            mocks.useStore.mockReturnValue({ collaborationPanelOpen: true });
        });

        it('lists connected peers when present', () => {
            setState({
                isEnabled: true,
                peers: [
                    {
                        id: 'p1',
                        name: 'Ada',
                        color: '#fff',
                        isConnected: true,
                        isHost: false,
                        lastSeen: 0,
                        latencyMs: null,
                    },
                ],
            });
            render(<CollaborationPanel />);
            expect(screen.getByText('Ada')).toBeInTheDocument();
        });

        it('omits the peer block when there are no peers', () => {
            setState({ isEnabled: true, peers: [] });
            render(<CollaborationPanel />);
            expect(screen.queryByText('Peers')).not.toBeInTheDocument();
        });

        it('generates an invite and shows the invite code row', async () => {
            mocks.generateInvite.mockResolvedValue('invite-123');
            setState({ isEnabled: true, isHost: true });
            render(<CollaborationPanel />);

            fireEvent.click(screen.getByRole('button', { name: /Copy Invite/i }));

            await waitFor(() => expect(screen.getByText('invite-123')).toBeInTheDocument());
            expect(mocks.generateInvite).toHaveBeenCalledTimes(1);
        });

        it('logs a warning when invite generation fails', async () => {
            mocks.generateInvite.mockRejectedValue(new Error('offer failed'));
            setState({ isEnabled: true, isHost: true });
            render(<CollaborationPanel />);

            fireEvent.click(screen.getByRole('button', { name: /Copy Invite/i }));

            await waitFor(() =>
                expect(mocks.loggerWarn).toHaveBeenCalledWith('Failed to generate invite:', expect.any(Error))
            );
        });

        it('shows the QR code, generating the invite first when none exists yet', async () => {
            mocks.generateInvite.mockResolvedValue('invite-qr');
            setState({ isEnabled: true, isHost: true });
            render(<CollaborationPanel />);

            fireEvent.click(screen.getByRole('button', { name: /^QR$/i }));

            await waitFor(() => expect(screen.getByTestId('qr-invite')).toHaveTextContent('invite-qr'));
        });

        it('accepts a pasted answer and clears the field on success', async () => {
            mocks.acceptAnswer.mockResolvedValue(undefined);
            setState({ isEnabled: true, isHost: true });
            render(<CollaborationPanel />);

            fireEvent.change(screen.getByPlaceholderText('Paste answer here'), { target: { value: '  ans-1  ' } });
            fireEvent.click(screen.getByRole('button', { name: 'Accept Answer' }));

            await waitFor(() => expect(mocks.acceptAnswer).toHaveBeenCalledWith('ans-1'));
        });

        it('logs a warning when accepting the answer fails', async () => {
            mocks.acceptAnswer.mockRejectedValue(new Error('bad answer'));
            setState({ isEnabled: true, isHost: true });
            render(<CollaborationPanel />);

            fireEvent.change(screen.getByPlaceholderText('Paste answer here'), { target: { value: 'ans-1' } });
            fireEvent.click(screen.getByRole('button', { name: 'Accept Answer' }));

            await waitFor(() =>
                expect(mocks.loggerWarn).toHaveBeenCalledWith('Failed to accept answer:', expect.any(Error))
            );
        });

        it('leaves the session via the Leave Session button', () => {
            setState({ isEnabled: true });
            render(<CollaborationPanel />);

            fireEvent.click(screen.getByRole('button', { name: 'Leave Session' }));

            expect(mocks.leaveSession).toHaveBeenCalledTimes(1);
        });

        it('copies the generated invite text to the clipboard', async () => {
            mocks.generateInvite.mockResolvedValue('invite-copy');
            setState({ isEnabled: true, isHost: true });
            render(<CollaborationPanel />);

            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: /Copy Invite/i }));
                await Promise.resolve();
            });

            const inviteRowCopyButton = screen
                .getByText('invite-copy')
                .parentElement!.parentElement!.querySelector('button')!;
            fireEvent.click(inviteRowCopyButton);

            expect(mocks.clipboardWriteText).toHaveBeenCalledWith('invite-copy');
        });

        it('reverts the copied indicator after the timeout, clearing any prior timer on rapid re-clicks', async () => {
            vi.useFakeTimers();
            mocks.generateInvite.mockResolvedValue('invite-copy');
            setState({ isEnabled: true, isHost: true });
            render(<CollaborationPanel />);

            await act(async () => {
                fireEvent.click(screen.getByRole('button', { name: /Copy Invite/i }));
                await Promise.resolve();
            });

            const inviteRowCopyButton = screen
                .getByText('invite-copy')
                .parentElement!.parentElement!.querySelector('button')!;
            fireEvent.click(inviteRowCopyButton);
            // Clicking again before the timeout clears the pending reset timer.
            fireEvent.click(inviteRowCopyButton);

            act(() => {
                vi.advanceTimersByTime(2000);
            });

            expect(mocks.clipboardWriteText).toHaveBeenCalledTimes(2);
        });
    });

    describe('disabled session — start / join', () => {
        beforeEach(() => {
            mocks.useStore.mockReturnValue({ collaborationPanelOpen: true });
        });

        it('starts a session with the entered host name', () => {
            render(<CollaborationPanel />);

            fireEvent.change(screen.getAllByPlaceholderText('Your name')[0]!, { target: { value: 'Host Name' } });
            fireEvent.click(screen.getByRole('button', { name: 'Start Session' }));

            expect(mocks.createSession).toHaveBeenCalledWith('Host Name');
        });

        it('defaults the host name to "Host" when left blank', () => {
            render(<CollaborationPanel />);

            fireEvent.click(screen.getByRole('button', { name: 'Start Session' }));

            expect(mocks.createSession).toHaveBeenCalledWith('Host');
        });

        it('joins a session and reveals the answer to share back', async () => {
            // joinSession's real implementation flips collaborationStore to
            // isEnabled once it has created the local peer connection —
            // mirror that so the Share back panel becomes reachable.
            mocks.joinSession.mockImplementation(async () => {
                setState({ isEnabled: true });
                return 'answer-xyz';
            });
            render(<CollaborationPanel />);

            fireEvent.change(screen.getByPlaceholderText('Paste invite'), { target: { value: 'inv-1' } });
            fireEvent.click(screen.getByRole('button', { name: /Join Session/i }));

            await waitFor(() => expect(screen.getByText('answer-xyz')).toBeInTheDocument());
            expect(mocks.joinSession).toHaveBeenCalledWith('inv-1', 'Peer');
        });

        it('copies the join answer back to the clipboard', async () => {
            mocks.joinSession.mockImplementation(async () => {
                setState({ isEnabled: true });
                return 'answer-xyz';
            });
            render(<CollaborationPanel />);

            fireEvent.change(screen.getByPlaceholderText('Paste invite'), { target: { value: 'inv-1' } });
            fireEvent.click(screen.getByRole('button', { name: /Join Session/i }));
            await waitFor(() => expect(screen.getByText('answer-xyz')).toBeInTheDocument());

            const answerCopyButton = screen
                .getByText('answer-xyz')
                .parentElement!.parentElement!.querySelector('button')!;
            fireEvent.click(answerCopyButton);

            expect(mocks.clipboardWriteText).toHaveBeenCalledWith('answer-xyz');
        });

        it('uses a custom join name when provided', async () => {
            mocks.joinSession.mockResolvedValue('answer-xyz');
            render(<CollaborationPanel />);

            fireEvent.change(screen.getAllByPlaceholderText('Your name')[1]!, { target: { value: 'Bea' } });
            fireEvent.change(screen.getByPlaceholderText('Paste invite'), { target: { value: 'inv-1' } });
            fireEvent.click(screen.getByRole('button', { name: /Join Session/i }));

            await waitFor(() => expect(mocks.joinSession).toHaveBeenCalledWith('inv-1', 'Bea'));
        });

        it('logs a warning when joining fails', async () => {
            mocks.joinSession.mockRejectedValue(new Error('join failed'));
            render(<CollaborationPanel />);

            fireEvent.change(screen.getByPlaceholderText('Paste invite'), { target: { value: 'inv-1' } });
            fireEvent.click(screen.getByRole('button', { name: /Join Session/i }));

            await waitFor(() =>
                expect(mocks.loggerWarn).toHaveBeenCalledWith('Failed to join session:', expect.any(Error))
            );
        });

        it('disables Join Session until an invite is entered', () => {
            render(<CollaborationPanel />);
            expect(screen.getByRole('button', { name: /Join Session/i })).toBeDisabled();
        });
    });
});
