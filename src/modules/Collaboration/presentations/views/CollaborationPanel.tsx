import { type ReactElement, useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { useCollaborationState } from '../hooks/useCollaborationState';
import { createSession, joinSession, leaveSession } from '../../useCases/collaboration';
import { closeCollaborationPanel } from '#/modules/Workspace/useCases/togglePanel/panelToggles';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { cn } from '#/helpers/Styles/cn';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { X, Copy, Check, Users, Wifi, WifiOff, Loader2 } from 'lucide-react';

export const CollaborationPanel = (): ReactElement | null => {
    const panelOpen = useSyncExternalStore(
        (cb) => workspaceStore.subscribe(cb),
        () => workspaceStore.value?.collaborationPanelOpen ?? false
    );

    const state = useCollaborationState();
    const [joinId, setJoinId] = useState('');
    const [joinName, setJoinName] = useState('');
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

    const close = closeCollaborationPanel;

    const handleCreate = () => {
        createSession();
    };

    const handleJoin = () => {
        const trimmedId = joinId.trim();
        if (trimmedId) {
            joinSession(trimmedId, joinName.trim() || 'Peer');
            setJoinId('');
            setJoinName('');
        }
    };

    const handleLeave = () => {
        leaveSession();
    };

    const handleCopySessionId = () => {
        if (state.sessionId) {
            void navigator.clipboard.writeText(state.sessionId);
            setCopied(true);
            if (copiedTimerRef.current !== null) {
                clearTimeout(copiedTimerRef.current);
            }
            copiedTimerRef.current = setTimeout(() => {
                setCopied(false);
                copiedTimerRef.current = null;
            }, 2000);
        }
    };

    const statusIcon = (() => {
        switch (state.connectionStatus) {
            case 'connected':
                return <Wifi className="size-3 text-[var(--color-state-success)]" />;
            case 'connecting':
                return <Loader2 className="size-3 animate-spin text-[var(--color-state-warning)]" />;
            case 'error':
                return <WifiOff className="size-3 text-[var(--color-state-danger)]" />;
            default:
                return <WifiOff className="size-3 text-muted-foreground" />;
        }
    })();

    const statusLabel = (() => {
        switch (state.connectionStatus) {
            case 'connected':
                return 'Connected';
            case 'connecting':
                return 'Connecting…';
            case 'error':
                return state.error ?? 'Connection error';
            default:
                return 'Disconnected';
        }
    })();

    return (
        <div className="absolute right-2 top-10 z-40 flex w-64 flex-col rounded-lg border border-border bg-popover shadow-xl">
            <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
                <div className="flex items-center gap-1.5">
                    <Users className="size-3.5 text-muted-foreground" />
                    <h3 className="text-xs font-medium text-foreground">Collaboration</h3>
                </div>
                <Button variant="ghost" size="icon-xs" onClick={close} aria-label="Close collaboration panel">
                    <X className="size-3" />
                </Button>
            </div>

            <div className="flex flex-col gap-3 p-3">
                <div className="flex items-center gap-2">
                    {statusIcon}
                    <span className="text-[11px] text-muted-foreground">{statusLabel}</span>
                </div>

                {state.isEnabled && state.sessionId ? (
                    <>
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                                Session ID
                            </span>
                            <div className="flex items-center gap-1">
                                <code className="flex-1 truncate rounded bg-muted/30 px-2 py-1 text-[10px] font-mono text-foreground">
                                    {state.sessionId}
                                </code>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={handleCopySessionId}
                                    aria-label="Copy session ID"
                                >
                                    {copied ? (
                                        <Check className="size-3 text-[var(--color-state-success)]" />
                                    ) : (
                                        <Copy className="size-3" />
                                    )}
                                </Button>
                            </div>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                                Peers ({state.peers.length})
                            </span>
                            <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                                {state.peers.map((peer) => (
                                    <div key={peer.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs">
                                        <span
                                            className={cn(
                                                'size-2 shrink-0 rounded-full',
                                                peer.isConnected ? 'opacity-100' : 'opacity-30'
                                            )}
                                            style={{ backgroundColor: peer.color }}
                                        />
                                        <span className="truncate text-foreground">
                                            {peer.name}
                                            {peer.id === state.localPeerId ? ' (you)' : ''}
                                        </span>
                                        {peer.isHost ? (
                                            <span className="ml-auto shrink-0 rounded bg-muted/40 px-1 text-[10px] text-muted-foreground">
                                                host
                                            </span>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <Button variant="outline" size="xs" onClick={handleLeave} className="w-full">
                            Leave Session
                        </Button>
                    </>
                ) : (
                    <>
                        <Button variant="default" size="xs" onClick={handleCreate} className="w-full">
                            Create Session
                        </Button>

                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                                Join Existing
                            </span>
                            <Input
                                value={joinName}
                                onChange={(e) => setJoinName(e.target.value)}
                                placeholder="Your name"
                                className="h-7 text-xs"
                            />
                            <Input
                                value={joinId}
                                onChange={(e) => setJoinId(e.target.value)}
                                placeholder="Session ID"
                                className="h-7 text-xs font-mono"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        handleJoin();
                                    }
                                }}
                            />
                            <Button
                                variant="outline"
                                size="xs"
                                onClick={handleJoin}
                                disabled={!joinId.trim()}
                                className="w-full"
                            >
                                Join Session
                            </Button>
                        </div>
                    </>
                )}

                {state.error ? <p className="text-[10px] text-[var(--color-state-danger)]">{state.error}</p> : null}
            </div>
        </div>
    );
};
