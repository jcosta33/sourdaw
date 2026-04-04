import { type ReactElement, useState, useRef, useEffect, useSyncExternalStore } from 'react';

import { DawEyebrowLabel } from '#/components/daw/DawEyebrowLabel';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { DawUtilityPanel } from '#/components/daw/DawUtilityPanel';
import { cn } from '#/helpers/Styles/cn';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { closeCollaborationPanel } from '#/modules/Workspace/useCases/togglePanel/panelToggles';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { X, Copy, Check, Users, Wifi, WifiOff, Loader2, QrCode } from 'lucide-react';

import { useCollaborationState } from '../hooks/useCollaborationState';
import {
    createSession,
    joinSession,
    leaveSession,
    generateInvite,
    acceptAnswer,
} from '../../useCases/collaboration';
import { QrInvite } from './QrInvite';


export const CollaborationPanel = (): ReactElement | null => {
    const panelOpen = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(cb),
        () => workspaceStore.value?.collaborationPanelOpen ?? false
    );

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
            if (copiedInviteTimerRef.current !== null) clearTimeout(copiedInviteTimerRef.current);
            if (copiedAnswerTimerRef.current !== null) clearTimeout(copiedAnswerTimerRef.current);
        };
    }, []);

    if (!panelOpen) {
        return null;
    }

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
            console.error('Failed to generate invite:', error);
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
            console.error('Failed to accept answer:', error);
        }
    };

    const handleJoin = async () => {
        setIsJoining(true);
        try {
            const answer = await joinSession(joinInvite.trim(), joinName.trim() || 'Peer');
            setJoinAnswer(answer);
            setJoinInvite('');
        } catch (error) {
            console.error('Failed to join session:', error);
        } finally {
            setIsJoining(false);
        }
    };

    const handleCopyInvite = () => {
        void navigator.clipboard.writeText(inviteString);
        setCopiedInvite(true);
        if (copiedInviteTimerRef.current !== null) clearTimeout(copiedInviteTimerRef.current);
        copiedInviteTimerRef.current = setTimeout(() => {
            setCopiedInvite(false);
            copiedInviteTimerRef.current = null;
        }, 2000);
    };

    const handleCopyAnswer = () => {
        void navigator.clipboard.writeText(joinAnswer);
        setCopiedAnswer(true);
        if (copiedAnswerTimerRef.current !== null) clearTimeout(copiedAnswerTimerRef.current);
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
            return `Collaborating \u00b7 ${state.peers.filter((p) => p.isConnected).length + 1} people`;
        }
        if (state.connectionStatus === 'connecting') {
            return 'Connecting...';
        }
        if (state.connectionStatus === 'error') {
            return state.error ?? 'Connection error';
        }
        return 'Not connected';
    })();

    return (
        <DawUtilityPanel className="absolute right-2 top-10 z-40 w-72">
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

            <div className="flex flex-col gap-3 p-3">
                {/* Status */}
                <div className="flex items-center gap-2">
                    {statusIcon}
                    <span className="text-[11px] text-muted-foreground">{statusLabel}</span>
                </div>

                {state.isEnabled ? (
                    <>
                        {/* Peer list */}
                        {state.peers.length > 0 ? (
                            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                                {state.peers.map((peer) => (
                                    <div key={peer.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs">
                                        <span
                                            className={cn('size-2 shrink-0 rounded-full', peer.isConnected ? 'opacity-100' : 'opacity-30')}
                                            style={{ backgroundColor: peer.color }}
                                        />
                                        <span className="truncate text-foreground">{peer.name}</span>
                                        {peer.isHost ? (
                                            <DawMicroBadge className="ml-auto px-1" tone="muted">host</DawMicroBadge>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {/* Host controls: invite methods */}
                        {state.isHost ? (
                            <div className="flex flex-col gap-1.5">
                                <div className="flex gap-1">
                                    <Button variant="outline" size="xs" onClick={handleGenerateInvite} disabled={isGeneratingInvite} className="flex-1 gap-1">
                                        {isGeneratingInvite ? <Loader2 className="size-3 animate-spin" /> : <Copy className="size-3" />}
                                        {isGeneratingInvite ? 'Gathering...' : 'Copy Invite'}
                                    </Button>
                                    <Button variant="outline" size="xs" onClick={handleShowQr} disabled={isGeneratingInvite} className="gap-1">
                                        <QrCode className="size-3" />
                                        QR
                                    </Button>
                                </div>
                                <p className="text-[10px] text-muted-foreground/60">
                                    Wait for each person to accept before inviting the next.
                                </p>

                                {/* QR code display */}
                                {showQr && inviteString ? (
                                    <QrInvite inviteString={inviteString} />
                                ) : null}

                                {/* Invite text (if generated but QR not shown) */}
                                {inviteString && !showQr ? (
                                    <div className="flex items-center gap-1">
                                        <code className="flex-1 truncate rounded bg-muted/30 px-2 py-1 text-[9px] font-mono text-foreground">
                                            {inviteString.slice(0, 40)}...
                                        </code>
                                        <Button variant="ghost" size="icon-xs" onClick={handleCopyInvite}>
                                            {copiedInvite ? <Check className="size-3 text-[var(--color-state-success)]" /> : <Copy className="size-3" />}
                                        </Button>
                                    </div>
                                ) : null}

                                {/* Accept answer from joiner */}
                                <Input
                                    value={answerString}
                                    onChange={(e) => setAnswerString(e.target.value)}
                                    placeholder="Paste answer here"
                                    className="h-7 text-xs font-mono"
                                />
                                <Button variant="outline" size="xs" onClick={handleAcceptAnswer} disabled={!answerString.trim()} className="w-full">
                                    Accept Answer
                                </Button>
                            </div>
                        ) : null}

                        {/* Joiner: show answer to copy back */}
                        {joinAnswer ? (
                            <div className="flex flex-col gap-1.5">
                                <DawEyebrowLabel size="sm">
                                    Send this answer to the host
                                </DawEyebrowLabel>
                                <div className="flex items-center gap-1">
                                    <code className="flex-1 truncate rounded bg-muted/30 px-2 py-1 text-[9px] font-mono text-foreground">
                                        {joinAnswer.slice(0, 40)}...
                                    </code>
                                    <Button variant="ghost" size="icon-xs" onClick={handleCopyAnswer}>
                                        {copiedAnswer ? <Check className="size-3 text-[var(--color-state-success)]" /> : <Copy className="size-3" />}
                                    </Button>
                                </div>
                            </div>
                        ) : null}

                        <Button variant="outline" size="xs" onClick={leaveSession} className="w-full">
                            Leave Session
                        </Button>
                    </>
                ) : (
                    <>
                        {/* Start Session */}
                        <div className="flex flex-col gap-1.5">
                            <Input
                                value={hostName}
                                onChange={(e) => setHostName(e.target.value)}
                                placeholder="Your name"
                                className="h-7 text-xs"
                            />
                            <Button variant="default" size="xs" onClick={handleCreate} className="w-full">
                                Start Session
                            </Button>
                        </div>

                        {/* Join Session */}
                        <div className="flex flex-col gap-1.5">
                            <Input
                                value={joinName}
                                onChange={(e) => setJoinName(e.target.value)}
                                placeholder="Your name"
                                className="h-7 text-xs"
                            />
                            <Input
                                value={joinInvite}
                                onChange={(e) => setJoinInvite(e.target.value)}
                                placeholder="Paste invite"
                                className="h-7 text-xs font-mono"
                            />
                            <Button variant="outline" size="xs" onClick={handleJoin} disabled={!joinInvite.trim() || isJoining} className="w-full gap-1">
                                {isJoining ? <Loader2 className="size-3 animate-spin" /> : null}
                                {isJoining ? 'Gathering...' : 'Join Session'}
                            </Button>
                        </div>
                    </>
                )}

                {state.error ? <p className="text-[10px] text-[var(--color-state-danger)]">{state.error}</p> : null}
            </div>
        </DawUtilityPanel>
    );
};
