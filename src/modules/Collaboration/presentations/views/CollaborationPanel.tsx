import { type KeyboardEvent, type ReactElement, useState, useRef, useEffect } from 'react';

import { X, Copy, Users, Wifi, WifiOff, Loader2, QrCode } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawUtilityNotice } from '#/components/daw/DawUtilityNotice';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { logger } from '#/infra/logger/appLogger';
import { useStore } from '#/infra/store/useStore';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { closeCollaborationPanel } from '#/modules/WorkspaceShell/useCases';

import { acceptAnswer } from '../../useCases/collaboration/acceptAnswer';
import { createSession } from '../../useCases/collaboration/createSession';
import { generateInvite } from '../../useCases/collaboration/generateInvite';
import { joinSession } from '../../useCases/collaboration/joinSession';
import { leaveSession } from '../../useCases/collaboration/leaveSession';
import { CollaborationBlock } from '../components/CollaborationBlock';
import { CollaborationStatusRow } from '../components/CollaborationStatusRow';
import { InviteCodeRow } from '../components/InviteCodeRow';
import { PeerPresenceRow } from '../components/PeerPresenceRow';
import { useCollaborationState } from '../hooks/useCollaborationState';

import { QrInvite } from './QrInvite';

type CollaborationWorkspaceState = {
    collaborationPanelOpen: boolean;
};

const defaultWorkspaceState: CollaborationWorkspaceState = {
    collaborationPanelOpen: false,
};

export const CollaborationPanel = (): ReactElement | null => {
    const workspace = useStore(workspaceStore, defaultWorkspaceState);
    const panelOpen = workspace.collaborationPanelOpen;

    const state = useCollaborationState();
    const [hostName, setHostName] = useState('');
    const [inviteString, setInviteString] = useState('');
    const [showQr, setShowQr] = useState(false);
    const [answerString, setAnswerString] = useState('');
    const [joinInvite, setJoinInvite] = useState('');
    const [joinName, setJoinName] = useState('');
    const [joinAnswer, setJoinAnswer] = useState('');
    const [copiedInvite, setCopiedInvite] = useState(false);
    const [copiedAnswer, setCopiedAnswer] = useState(false);
    const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);
    const [isJoining, setIsJoining] = useState(false);
    const copiedInviteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copiedAnswerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (copiedInviteTimerRef.current !== null) {
                clearTimeout(copiedInviteTimerRef.current);
            }
            if (copiedAnswerTimerRef.current !== null) {
                clearTimeout(copiedAnswerTimerRef.current);
            }
        };
    }, []);

    if (!panelOpen) {
        return null;
    }

    const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closeCollaborationPanel();
        }
    };

    const handleCreate = () => {
        createSession(hostName.trim() || 'Host');
    };

    const handleGenerateInvite = async () => {
        setIsGeneratingInvite(true);
        try {
            const invite = await generateInvite();
            setInviteString(invite);
            setShowQr(false);
        } catch (error) {
            logger.warn('Failed to generate invite:', error);
        } finally {
            setIsGeneratingInvite(false);
        }
    };

    const handleShowQr = async () => {
        if (!inviteString) {
            await handleGenerateInvite();
        }
        setShowQr(true);
    };

    const handleAcceptAnswer = async () => {
        try {
            await acceptAnswer(answerString.trim());
            setAnswerString('');
        } catch (error) {
            logger.warn('Failed to accept answer:', error);
        }
    };

    const handleJoin = async () => {
        setIsJoining(true);
        try {
            const answer = await joinSession(joinInvite.trim(), joinName.trim() || 'Peer');
            setJoinAnswer(answer);
            setJoinInvite('');
        } catch (error) {
            logger.warn('Failed to join session:', error);
        } finally {
            setIsJoining(false);
        }
    };

    const handleCopyInvite = () => {
        void navigator.clipboard.writeText(inviteString);
        setCopiedInvite(true);
        if (copiedInviteTimerRef.current !== null) {
            clearTimeout(copiedInviteTimerRef.current);
        }
        copiedInviteTimerRef.current = setTimeout(() => {
            setCopiedInvite(false);
            copiedInviteTimerRef.current = null;
        }, 2000);
    };

    const handleCopyAnswer = () => {
        void navigator.clipboard.writeText(joinAnswer);
        setCopiedAnswer(true);
        if (copiedAnswerTimerRef.current !== null) {
            clearTimeout(copiedAnswerTimerRef.current);
        }
        copiedAnswerTimerRef.current = setTimeout(() => {
            setCopiedAnswer(false);
            copiedAnswerTimerRef.current = null;
        }, 2000);
    };

    const statusIcon = (() => {
        if (state.connectionStatus === 'connected') {
            return <Wifi className="size-3 text-[var(--color-state-success)]" />;
        }
        if (state.connectionStatus === 'connecting') {
            return <Loader2 className="size-3 animate-spin text-[var(--color-state-warning)]" />;
        }
        if (state.connectionStatus === 'error') {
            return <WifiOff className="size-3 text-[var(--color-state-danger)]" />;
        }
        return <WifiOff className="size-3 text-muted-foreground" />;
    })();

    const statusLabel = (() => {
        if (state.connectionStatus === 'connected') {
            return `Collaborating \u00B7 ${state.peers.filter((param) => param.isConnected).length + 1} people`;
        }
        if (state.connectionStatus === 'connecting') {
            return 'Connecting...';
        }
        if (state.connectionStatus === 'error') {
            return state.error ?? 'Connection error';
        }
        return 'Not connected';
    })();

    // A quarantined peer stays in the peer list, connected, with live
    // presence — the divergence is invisible unless it is said out loud, and
    // it lasts until that peer is gone, so this row is not part of the
    // transient error slot and nothing routine takes it down.
    const quarantinedPeerLabel = (() => {
        if (state.quarantinedPeerIds.length === 0) {
            return null;
        }
        const names = state.quarantinedPeerIds.map(
            (peerId) => state.peers.find((peer) => peer.id === peerId)?.name ?? 'a peer'
        );
        return `Stopped syncing with ${names.join(', ')} — their changes could not be applied after repeated attempts. Have them rejoin the session.`;
    })();

    return (
        <DawUtilityPanel
            className="absolute right-2 top-10 z-40 w-72"
            role="dialog"
            aria-label="Collaborate"
            tabIndex={-1}
            onKeyDown={handlePanelKeyDown}
        >
            {/* Header */}
            <DawHeaderBand
                className="rounded-t-lg px-3 py-2"
                startSlot={<Users className="size-3.5 text-muted-foreground" />}
                title="Collaborate"
                titleClassName="text-xs font-medium normal-case tracking-normal text-foreground"
                actions={
                    <Button variant="ghost" size="icon-xs" onClick={closeCollaborationPanel} aria-label="Close">
                        <X className="size-3" />
                    </Button>
                }
            />
            <Stack gap={3} className="p-3">
                {/* Status */}
                <CollaborationStatusRow icon={statusIcon} label={statusLabel} />

                {state.isEnabled ? (
                    <>
                        {/* Peer list */}
                        {state.peers.length > 0 ? (
                            <CollaborationBlock
                                title="Peers"
                                description="Everyone currently connected to the shared session."
                                className="max-h-40 overflow-y-auto"
                            >
                                <Stack gap={1}>
                                    {state.peers.map((peer) => (
                                        <PeerPresenceRow
                                            key={peer.id}
                                            name={peer.name}
                                            color={peer.color}
                                            isConnected={peer.isConnected}
                                            isHost={peer.isHost}
                                        />
                                    ))}
                                </Stack>
                            </CollaborationBlock>
                        ) : null}

                        {/* Host controls: invite methods */}
                        {state.isHost ? (
                            <CollaborationBlock
                                title="Invite"
                                description="Generate an invite, share it, then accept the join answer."
                                className="flex flex-col gap-1.5"
                            >
                                <Row align="stretch" gap={1}>
                                    <Button
                                        variant="outline"
                                        size="xs"
                                        onClick={handleGenerateInvite}
                                        disabled={isGeneratingInvite}
                                        className="flex-1 gap-1"
                                    >
                                        {isGeneratingInvite ? (
                                            <Loader2 className="size-3 animate-spin" />
                                        ) : (
                                            <Copy className="size-3" />
                                        )}
                                        {isGeneratingInvite ? 'Gathering...' : 'Copy Invite'}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="xs"
                                        onClick={handleShowQr}
                                        disabled={isGeneratingInvite}
                                        className="gap-1"
                                    >
                                        <QrCode className="size-3" />
                                        QR
                                    </Button>
                                </Row>
                                <DawUtilityNotice className="px-2.5 py-2 text-[10px] text-muted-foreground/60">
                                    Wait for each person to accept before inviting the next.
                                </DawUtilityNotice>

                                {/* QR code display */}
                                {showQr && inviteString ? <QrInvite inviteString={inviteString} /> : null}

                                {/* Invite text (if generated but QR not shown) */}
                                {inviteString && !showQr ? (
                                    <InviteCodeRow
                                        value={inviteString}
                                        copied={copiedInvite}
                                        onCopy={handleCopyInvite}
                                    />
                                ) : null}

                                {/* Accept answer from joiner */}
                                <DawCompactInput
                                    value={answerString}
                                    onChange={(event) => setAnswerString(event.target.value)}
                                    placeholder="Paste answer here"
                                    monospace
                                />
                                <Button
                                    variant="outline"
                                    size="xs"
                                    onClick={handleAcceptAnswer}
                                    disabled={!answerString.trim()}
                                    className="w-full"
                                >
                                    Accept Answer
                                </Button>
                            </CollaborationBlock>
                        ) : null}

                        {/* Joiner: show answer to copy back */}
                        {joinAnswer ? (
                            <CollaborationBlock
                                title="Share back"
                                description="Send this answer to the host so they can complete the connection."
                                className="flex flex-col gap-1.5"
                            >
                                <InviteCodeRow value={joinAnswer} copied={copiedAnswer} onCopy={handleCopyAnswer} />
                            </CollaborationBlock>
                        ) : null}

                        <Button variant="outline" size="xs" onClick={leaveSession} className="w-full">
                            Leave Session
                        </Button>
                    </>
                ) : (
                    <>
                        {/* Start Session */}
                        <CollaborationBlock
                            title="Start session"
                            description="Host a live editing room from this machine."
                            className="flex flex-col gap-1.5"
                        >
                            <DawCompactInput
                                value={hostName}
                                onChange={(event) => setHostName(event.target.value)}
                                placeholder="Your name"
                            />
                            <Button variant="default" size="xs" onClick={handleCreate} className="w-full">
                                Start Session
                            </Button>
                        </CollaborationBlock>

                        {/* Join Session */}
                        <CollaborationBlock
                            title="Join session"
                            description="Paste an invite from the host and create your answer."
                            className="flex flex-col gap-1.5"
                        >
                            <DawCompactInput
                                value={joinName}
                                onChange={(event) => setJoinName(event.target.value)}
                                placeholder="Your name"
                            />
                            <DawCompactInput
                                value={joinInvite}
                                onChange={(event) => setJoinInvite(event.target.value)}
                                placeholder="Paste invite"
                                monospace
                            />
                            <Button
                                variant="outline"
                                size="xs"
                                onClick={handleJoin}
                                disabled={!joinInvite.trim() || isJoining}
                                className="w-full gap-1"
                            >
                                {isJoining ? <Loader2 className="size-3 animate-spin" /> : null}
                                {isJoining ? 'Gathering...' : 'Join Session'}
                            </Button>
                        </CollaborationBlock>
                    </>
                )}

                {quarantinedPeerLabel ? (
                    <CollaborationStatusRow
                        icon={<WifiOff className="size-3 text-[var(--color-state-danger)]" />}
                        label={quarantinedPeerLabel}
                        tone="danger"
                    />
                ) : null}

                {state.error ? (
                    <CollaborationStatusRow
                        icon={<WifiOff className="size-3 text-[var(--color-state-danger)]" />}
                        label={state.error}
                        tone="danger"
                    />
                ) : null}
            </Stack>
        </DawUtilityPanel>
    );
};
