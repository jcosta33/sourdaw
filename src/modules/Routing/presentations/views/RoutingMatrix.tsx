/**
 * Mixer Routing Matrix component.
 *
 * Grid-based view over the real routing read-model: rows are source tracks,
 * bus/folder columns are post-fader sends (`track.sends`), and the Master
 * column reflects each track's primary output (`track.outputId`). Cells write
 * through the Arrangement send/output use cases — the same CRDT-backed path the
 * mixer strips use — so every toggle changes the audio graph and undo history.
 */
import { type ReactElement } from 'react';

import { DawDiagramFrame } from '#/components/daw/DawDiagramFrame';
import { removeSend, setSend, setTrackOutput } from '#/modules/Arrangement/useCases';
import { cn } from '#/utils/Styles/cn';

import { type Track } from '../../models/TrackViewTypes';
import { useTracks } from '../hooks/useTracks';

const MASTER_ID = 'master';

type Destination = {
    id: string;
    name: string;
    kind: Track['kind'];
};

function isSourceSentToBus(source: Track, busId: string): boolean {
    return source.sends.some((send) => send.busId === busId);
}

export const RoutingMatrix = (): ReactElement => {
    const { tracks } = useTracks();

    const buses = tracks.filter((track: Track) => track.kind === 'bus' || track.kind === 'folder');
    const sources = tracks.filter((track: Track) => track.kind !== 'bus' && track.kind !== 'folder');

    // Destination columns: buses/folders (send targets) plus the Master output.
    const destinations: Destination[] = [...buses, { id: MASTER_ID, name: 'Master', kind: 'master' }];

    const toggleSend = (source: Track, busId: string, connected: boolean): void => {
        if (connected) {
            removeSend(source.id, busId);
            return;
        }
        setSend(source.id, busId, 1);
    };

    const routeOutputToMaster = (source: Track, connected: boolean): void => {
        if (connected) {
            return;
        }
        setTrackOutput(source.id, MASTER_ID);
    };

    return (
        <DawDiagramFrame
            title="Routing matrix"
            className="h-full"
            footer={
                <div className="text-[10px] text-muted-foreground">
                    Click a bus cell to toggle a send; the Master column shows each track&rsquo;s output.
                </div>
            }
        >
            <div className="min-w-max">
                <table className="border-collapse text-[10px]">
                    <thead>
                        <tr>
                            <th className="p-1 text-muted-foreground font-normal text-left sticky left-0 bg-surface-base z-10">
                                Source ↓ / Dest →
                            </th>
                            {destinations.map((dest) => (
                                <th
                                    key={dest.id}
                                    className="p-1 text-muted-foreground font-normal text-center min-w-[40px] border-l border-border/20"
                                >
                                    <span
                                        className="writing-mode-vertical block rotate-180"
                                        style={{ writingMode: 'vertical-rl' }}
                                    >
                                        {dest.name}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sources.map((src: Track) => (
                            <tr key={src.id} className="border-t border-border/10">
                                <td
                                    className="p-1 text-foreground sticky left-0 bg-surface-base z-10 truncate max-w-[80px]"
                                    style={{ borderLeftColor: src.color, borderLeftWidth: src.color ? 3 : 0 }}
                                >
                                    {src.name}
                                </td>
                                {destinations.map((dest) => {
                                    const isSelf = src.id === dest.id;
                                    if (isSelf) {
                                        return (
                                            <td key={dest.id} className="p-0.5 text-center border-l border-border/10">
                                                <span className="text-muted-foreground/30">—</span>
                                            </td>
                                        );
                                    }

                                    const isMaster = dest.id === MASTER_ID;
                                    const isConnected = isMaster
                                        ? src.outputId === MASTER_ID
                                        : isSourceSentToBus(src, dest.id);

                                    let ariaLabel: string;
                                    if (isMaster) {
                                        ariaLabel = isConnected
                                            ? `${src.name} output routed to Master`
                                            : `Route ${src.name} output to Master`;
                                    } else {
                                        ariaLabel = `${isConnected ? 'Disconnect' : 'Connect'} ${src.name} → ${dest.name}`;
                                    }

                                    const handleClick = (): void => {
                                        if (isMaster) {
                                            routeOutputToMaster(src, isConnected);
                                            return;
                                        }
                                        toggleSend(src, dest.id, isConnected);
                                    };

                                    return (
                                        <td key={dest.id} className="p-0.5 text-center border-l border-border/10">
                                            <button
                                                type="button"
                                                disabled={isMaster && isConnected}
                                                className={cn(
                                                    'size-4 rounded-sm border transition-colors',
                                                    isConnected
                                                        ? 'bg-[var(--color-state-success)]/40 border-[var(--color-state-success)]/60 hover:bg-[var(--color-state-success)]/50'
                                                        : 'bg-muted/10 border-border/20 hover:bg-muted/30',
                                                    isMaster && isConnected ? 'cursor-default' : null
                                                )}
                                                onClick={handleClick}
                                                aria-label={ariaLabel}
                                                title={`${src.name} → ${dest.name}`}
                                            >
                                                {isConnected ? (
                                                    <span className="text-[6px] text-[var(--color-state-success)]">
                                                        ●
                                                    </span>
                                                ) : null}
                                            </button>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </DawDiagramFrame>
    );
};
