/**
 * Mixer Routing Matrix component.
 * Grid-based UI for connecting track outputs to buses, sends, and sidechain inputs.
 * Rows = source tracks, Columns = destination buses/tracks.
 */
import { type ReactElement, useState } from 'react';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { cn } from '#/helpers/Styles/cn';
import { useTracks } from '../hooks/useTracks';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';

type RoutingConnection = {
    sourceId: string;
    destId: string;
    level: number; // 0-1
};

export const RoutingMatrix = (): ReactElement => {
    const { tracks } = useTracks();
    const [connections, setConnections] = useState<Map<string, RoutingConnection>>(new Map());

    const getKey = (srcId: string, destId: string): string => `${srcId}→${destId}`;

    const toggleConnection = (srcId: string, destId: string): void => {
        const key = getKey(srcId, destId);
        setConnections((prev) => {
            const next = new Map(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.set(key, { sourceId: srcId, destId, level: 1.0 });
            }
            return next;
        });
    };

    // Separate buses from regular tracks
    const buses = tracks.filter((t: Track) => t.kind === 'bus' || t.kind === 'folder');
    const sources = tracks.filter((t: Track) => t.kind !== 'bus' && t.kind !== 'folder');

    // Destination columns: buses + Master
    const destinations = [...buses, { id: 'master', name: 'Master', kind: 'master' as const }];

    return (
        <div className="flex flex-col h-full bg-surface-base overflow-auto">
            <DawHeaderBand
                className="shrink-0"
                title="Routing Matrix"
                titleClassName="text-[11px] font-semibold text-foreground uppercase tracking-wider"
            />

            <div className="overflow-auto flex-1 p-2">
                <table className="border-collapse text-[10px]">
                    <thead>
                        <tr>
                            <th className="p-1 text-muted-foreground font-normal text-left sticky left-0 bg-surface-base z-10">
                                Source ↓ / Dest →
                            </th>
                            {destinations.map((d) => (
                                <th
                                    key={d.id}
                                    className="p-1 text-muted-foreground font-normal text-center min-w-[40px] border-l border-border/20"
                                >
                                    <span
                                        className="writing-mode-vertical block rotate-180"
                                        style={{ writingMode: 'vertical-rl' }}
                                    >
                                        {d.name}
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
                                    const key = getKey(src.id, dest.id);
                                    const isConnected = connections.has(key);
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
                                                        <span className="text-[6px] text-[var(--color-state-success)]">●</span>
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
        </div>
    );
};
