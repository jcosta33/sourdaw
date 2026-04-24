/**
 * Mixer Routing Matrix component.
 * Grid-based UI for connecting track outputs to buses, sends, and sidechain inputs.
 * Rows = source tracks, Columns = destination buses/tracks.
 */
import { type ReactElement } from 'react';

import { DawDiagramFrame } from '#/components/daw/DawDiagramFrame';
import { useStore } from '#/infra/store/useStore';
import { cn } from '#/utils/Styles/cn';

import { type Track } from '../../models/TrackViewTypes';
import { routingConnectionKey, routingMatrixStore, type RoutingMatrixState } from '../../stores/routingMatrixStore';
import { useTracks } from '../hooks/useTracks';

const emptyState: RoutingMatrixState = { connections: {} };

export const RoutingMatrix = (): ReactElement => {
    const { tracks } = useTracks();
    // §83.1 — state lives in a module-level store so closing and reopening
    // the panel no longer silently discards every route the user configured.
    const state = useStore(routingMatrixStore, emptyState);
    const connections = state.connections;

    const toggleConnection = (srcId: string, destId: string): void => {
        const key = routingConnectionKey(srcId, destId);
        const current = routingMatrixStore.value ?? emptyState;
        const next = { ...current.connections };
        if (key in next) {
            delete next[key];
        } else {
            next[key] = { sourceId: srcId, destId, level: 1.0 };
        }
        routingMatrixStore.set({ connections: next });
    };

    // Separate buses from regular tracks
    const buses = tracks.filter((time: Track) => time.kind === 'bus' || time.kind === 'folder');
    const sources = tracks.filter((time: Track) => time.kind !== 'bus' && time.kind !== 'folder');

    // Destination columns: buses + Master
    const destinations = [...buses, { id: 'master', name: 'Master', kind: 'master' as const }];

    return (
        <DawDiagramFrame
            title="Routing matrix"
            className="h-full"
            footer={<div className="text-[10px] text-muted-foreground">Click any cell to toggle a route.</div>}
        >
            <div className="min-w-max">
                <table className="border-collapse text-[10px]">
                    <thead>
                        <tr>
                            <th className="p-1 text-muted-foreground font-normal text-left sticky left-0 bg-surface-base z-10">
                                Source ↓ / Dest →
                            </th>
                            {destinations.map((data) => (
                                <th
                                    key={data.id}
                                    className="p-1 text-muted-foreground font-normal text-center min-w-[40px] border-l border-border/20"
                                >
                                    <span
                                        className="writing-mode-vertical block rotate-180"
                                        style={{ writingMode: 'vertical-rl' }}
                                    >
                                        {data.name}
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
                                    const key = routingConnectionKey(src.id, dest.id);
                                    const isConnected = key in connections;
                                    const isSelf = src.id === dest.id;

                                    return (
                                        <td key={dest.id} className="p-0.5 text-center border-l border-border/10">
                                            {isSelf ? (
                                                <span className="text-muted-foreground/30">—</span>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className={cn(
                                                        'size-4 rounded-sm border transition-colors',
                                                        isConnected
                                                            ? 'bg-[var(--color-state-success)]/40 border-[var(--color-state-success)]/60 hover:bg-[var(--color-state-success)]/50'
                                                            : 'bg-muted/10 border-border/20 hover:bg-muted/30'
                                                    )}
                                                    onClick={() => toggleConnection(src.id, dest.id)}
                                                    aria-label={`${isConnected ? 'Disconnect' : 'Connect'} ${src.name} → ${dest.name}`}
                                                    title={`${src.name} → ${dest.name}`}
                                                >
                                                    {isConnected ? (
                                                        <span className="text-[6px] text-[var(--color-state-success)]">
                                                            ●
                                                        </span>
                                                    ) : null}
                                                </button>
                                            )}
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
