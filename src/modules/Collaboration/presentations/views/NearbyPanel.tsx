import { type ReactElement, useState, useEffect } from 'react';

import { Wifi, Loader2 } from 'lucide-react';

import {
    type NearbySession,
    isLanDiscoveryAvailable,
    startBrowsing,
    getNearbySessions,
} from '../../useCases/lanDiscovery';

type NearbyPanelProps = {
    onJoinNearby: (session: NearbySession) => void;
};

/**
 * Shows nearby collaboration sessions discovered via mDNS on the local network.
 * Only available in Tauri desktop builds.
 */
export const NearbyPanel = ({ onJoinNearby }: NearbyPanelProps): ReactElement | null => {
    const [sessions, setSessions] = useState<NearbySession[]>([]);
    const [browsing, setBrowsing] = useState(false);
    const available = isLanDiscoveryAvailable();

    useEffect(() => {
        if (!available) {
            return;
        }

        startBrowsing().then((started) => {
            if (started) {
                setBrowsing(true);
            }
        }).catch(() => {});

        // Poll for discovered sessions
        const interval = setInterval(() => {
            getNearbySessions().then(setSessions).catch(() => {});
        }, 2000);

        return () => {
            clearInterval(interval);
        };
    }, [available]);

    if (!available) {
        return (
            <p className="text-[10px] text-muted-foreground/50 text-center italic">
                Nearby discovery requires the desktop app
            </p>
        );
    }

    if (sessions.length === 0) {
        return (
            <div className="flex flex-col items-center gap-2 py-2">
                {browsing ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : (
                    <Wifi className="size-4 text-muted-foreground" />
                )}
                <p className="text-[10px] text-muted-foreground/50 text-center">
                    {browsing ? 'Looking for sessions on your network...' : 'No nearby sessions found'}
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            {sessions.map((session) => (
                <button
                    key={session.instanceName}
                    onClick={() => onJoinNearby(session)}
                    className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/30 transition-colors"
                >
                    <Wifi className="size-3 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                        <div className="truncate text-foreground font-medium">{session.hostName}</div>
                        <div className="truncate text-[10px] text-muted-foreground">{session.projectName}</div>
                    </div>
                    {session.approvalRequired ? (
                        <span className="shrink-0 rounded bg-muted/40 px-1 text-[9px] text-muted-foreground">
                            approval
                        </span>
                    ) : null}
                </button>
            ))}
        </div>
    );
};
