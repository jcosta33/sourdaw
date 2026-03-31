import { type ReactElement, useState, useRef, useEffect, useSyncExternalStore } from 'react';

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
import { NearbyPanel } from './NearbyPanel';

type JoinTab = 'paste' | 'qr' | 'nearby';

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
    const [joinTab, setJoinTab] = useState<JoinTab>('paste');
    const [copied, setCopied] = useState(false);
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (copiedTimerRef.current !== null) {
                clearTimeout(copiedTimerRef.current);
            }
        };
    }, []);

    if (!panelOpen) {
        return null;
    }

    const handleCreate = () => {
        createSession(hostName.trim() || 'Host');
    };

    const handleGenerateInvite = async () => {
        try {
            const invite = await generateInvite();
            setInviteString(invite);
            setShowQr(false);
        } catch (error) {
            console.error('Failed to generate invite:', error);
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
        try {
            const answer = await joinSession(joinInvite.trim(), joinName.trim() || 'Peer');
            setJoinAnswer(answer);
            setJoinInvite('');
        } catch (error) {
            console.error('Failed to join session:', error);
        }
    };

    const handleCopy = (text: string) => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        if (copiedTimerRef.current !== null) {
            clearTimeout(copiedTimerRef.current);
        }
        copiedTimerRef.current = setTimeout(() => {
            setCopied(false);
            copiedTimerRef.current = null;
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
        <div className="absolute right-2 top-10 z-40 flex w-72 flex-col rounded-lg border border-border bg-popover shadow-xl" style={{ border: '1px solid rgba(0,0,0,0.4)' }}>
            {/* Header */}
            <div
                className="flex items-center justify-between px-3 py-2"
                style={{
                    background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: '8px 8px 0 0',
                }}
            >
                <div className="flex items-center gap-1.5">
                    <Users className="size-3.5 text-muted-foreground" />
                    <h3 className="text-xs font-medium text-foreground">Collaborate</h3>
                </div>
                <Button variant="ghost" size="icon-xs" onClick={closeCollaborationPanel} aria-label="Close">
                    <X className="size-3" />
                </Button>
            </div>

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
                                            <span className="ml-auto shrink-0 rounded bg-muted/40 px-1 text-[10px] text-muted-foreground">host</span>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        {/* Host controls: invite methods */}
                        {state.isHost ? (
                            <div className="flex flex-col gap-1.5">
                                {/* Three invite buttons per spec */}
                                <div className="flex gap-1">
                                    <Button variant="outline" size="xs" onClick={handleGenerateInvite} className="flex-1 gap-1">
                                        <Copy className="size-3" />
                                        Copy Invite
                                    </Button>
                                    <Button variant="outline" size="xs" onClick={handleShowQr} className="gap-1">
                                        <QrCode className="size-3" />
                                        QR
                                    </Button>
                                </div>

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
                                        <Button variant="ghost" size="icon-xs" onClick={() => handleCopy(inviteString)}>
                                            {copied ? <Check className="size-3 text-[var(--color-state-success)]" /> : <Copy className="size-3" />}
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
                                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                                    Send this answer to the host
                                </span>
                                <div className="flex items-center gap-1">
                                    <code className="flex-1 truncate rounded bg-muted/30 px-2 py-1 text-[9px] font-mono text-foreground">
                                        {joinAnswer.slice(0, 40)}...
                                    </code>
                                    <Button variant="ghost" size="icon-xs" onClick={() => handleCopy(joinAnswer)}>
                                        {copied ? <Check className="size-3 text-[var(--color-state-success)]" /> : <Copy className="size-3" />}
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

                        {/* Join Session — tabs: Paste / QR / Nearby */}
                        <div className="flex flex-col gap-1.5">
                            <div className="flex gap-1">
                                {(['paste', 'nearby'] as const).map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setJoinTab(tab)}
                                        className={cn(
                                            'flex-1 rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors',
                                            joinTab === tab
                                                ? 'bg-muted/50 text-foreground'
                                                : 'text-muted-foreground/60 hover:text-muted-foreground'
                                        )}
                                    >
                                        {tab === 'paste' ? 'Paste Invite' : 'Nearby'}
                                    </button>
                                ))}
                            </div>

                            {joinTab === 'paste' ? (
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
                                    <Button variant="outline" size="xs" onClick={handleJoin} disabled={!joinInvite.trim()} className="w-full">
                                        Join Session
                                    </Button>
                                </div>
                            ) : null}

                            {joinTab === 'nearby' ? (
                                <NearbyPanel onJoinNearby={() => {
                                    // LAN discovery join flow — would generate an invite
                                    // from the discovered session's address and auto-connect.
                                    // Full implementation requires the discovered peer to
                                    // also exchange signaling data, which is a Phase 3+ refinement.
                                }} />
                            ) : null}
                        </div>
                    </>
                )}

                {state.error ? <p className="text-[10px] text-[var(--color-state-danger)]">{state.error}</p> : null}
            </div>
        </div>
    );
};
