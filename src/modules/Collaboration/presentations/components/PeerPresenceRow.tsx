import { type ReactElement } from 'react';

import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type PeerPresenceRowProps = {
    name: string;
    color: string;
    isConnected: boolean;
    isHost: boolean;
    syncHealth: 'converging' | 'diverged';
};

function getPeerStatusLabel(isConnected: boolean, syncHealth: PeerPresenceRowProps['syncHealth']): string {
    if (!isConnected) {
        return 'Idle';
    }
    if (syncHealth === 'diverged') {
        return 'Diverged';
    }
    return 'Live';
}

export const PeerPresenceRow = ({
    name,
    color,
    isConnected,
    isHost,
    syncHealth,
}: PeerPresenceRowProps): ReactElement => (
    <Row
        gap={2}
        className="rounded-md border border-white/8 bg-black/20 px-2 py-1.5 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
    >
        <span
            className={cn('size-2 shrink-0 rounded-full', isConnected ? 'opacity-100' : 'opacity-30')}
            style={{ backgroundColor: color }}
        />
        <span className="truncate text-foreground/90">{name}</span>
        <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/45">
            {getPeerStatusLabel(isConnected, syncHealth)}
        </span>
        {isHost ? (
            <DawMicroBadge className="ml-auto px-1" tone="muted">
                host
            </DawMicroBadge>
        ) : null}
    </Row>
);
