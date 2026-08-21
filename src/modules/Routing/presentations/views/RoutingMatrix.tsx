/**
 * Mixer Routing Matrix component.
 *
 * Grid over the real routing read-model. Rows are signal sources (audio, MIDI,
 * and bus tracks — buses both send and output); columns are the bus tracks plus
 * the Master output. Every cell reflects and writes real routing truth through
 * the same CRDT-backed Arrangement use cases the mixer strips use:
 *
 * - A bus column shows the source's PRIMARY OUTPUT edge (`track.outputId`) when
 *   the output routes there — rendered distinctly from a send and read-only, so
 *   the matrix never stacks a duplicate send on top of an existing output path
 *   (output routing is changed in the mixer I/O section). Otherwise the cell is
 *   a post-fader SEND toggle: connected when an active send (`level > 0`) exists.
 * - The Master column shows the output edge to master; clicking a non-master
 *   track routes its output back to master, and the cell is the current-output
 *   indicator (disabled) once it already outputs there.
 *
 * Folders are excluded from both axes: the rest of the app restricts routing
 * endpoints to `kind === 'bus'`, and a folder target would manufacture a phantom
 * audible bus strip. Sends are created at unit level — there is no mixer
 * send-creation default (the Sends strip tunes from a 0 slider), so the matrix,
 * a binary on/off router, connects at full and delegates level tuning to the
 * mixer; disconnecting removes the send outright (reconnecting starts fresh).
 */
import { type ReactElement } from 'react';

import { DawDiagramFrame } from '#/components/daw/DawDiagramFrame';
import { Button } from '#/components/ui/button';
import { removeSend, setSend, setTrackOutput } from '#/modules/Arrangement/useCases';
import { wouldCreateRoutingCycle } from '#/utils/routingCycle';
import { cn } from '#/utils/Styles/cn';

import { type Track } from '../../models/TrackViewTypes';
import { useTracks } from '../hooks/useTracks';

const MASTER_ID = 'master';

// A matrix "connect" is a binary route-on: there is no mixer send-creation
// default (the Sends strip tunes from a 0 slider), so the matrix routes at full
// level and leaves level tuning to the mixer.
const NEW_SEND_LEVEL = 1;

type Destination = {
    id: string;
    name: string;
    kind: Track['kind'];
};

type CellKind = 'output' | 'send-on' | 'send-off';

type CellDescriptor = {
    kind: CellKind;
    ariaLabel: string;
    title: string;
    disabled: boolean;
    onClick: (() => void) | undefined;
};

function findActiveSendLevel(source: Track, busId: string): number | null {
    const send = source.sends.find((state) => state.busId === busId);
    if (!send || send.level <= 0) {
        return null;
    }
    return send.level;
}

export const RoutingMatrix = (): ReactElement => {
    const { tracks } = useTracks();

    const busTracks = tracks.filter((track: Track) => track.kind === 'bus');
    // Buses are sources too — they carry sends and an output. Folders/master are
    // never sources; folders never appear as endpoints anywhere in the app.
    const sources = tracks.filter(
        (track: Track) => track.kind === 'audio' || track.kind === 'midi' || track.kind === 'bus'
    );

    const destinations: Destination[] = [...busTracks, { id: MASTER_ID, name: 'Master', kind: 'master' }];

    const describeCell = (src: Track, dest: Destination): CellDescriptor => {
        const isMaster = dest.id === MASTER_ID;
        const routesOutputHere = src.outputId === dest.id;

        if (isMaster) {
            if (routesOutputHere) {
                return {
                    kind: 'output',
                    ariaLabel: `${src.name} output routed to Master`,
                    title: 'Track output — already routed to Master',
                    disabled: true,
                    onClick: undefined,
                };
            }
            return {
                kind: 'send-off',
                ariaLabel: `Route ${src.name} output to Master`,
                title: `Route ${src.name} output to Master`,
                disabled: false,
                onClick: () => setTrackOutput(src.id, MASTER_ID),
            };
        }

        if (routesOutputHere) {
            // The track's primary output already lands on this bus. Rendering a
            // send toggle here would let a click stack a second, duplicate signal
            // path onto the same bus, so the cell is a read-only output marker;
            // output routing is changed in the mixer I/O section.
            return {
                kind: 'output',
                ariaLabel: `${src.name} output routed to ${dest.name}`,
                title: `Track output — routes to ${dest.name} (change in the mixer I/O section)`,
                disabled: true,
                onClick: undefined,
            };
        }

        const sendLevel = findActiveSendLevel(src, dest.id);
        if (sendLevel !== null) {
            return {
                kind: 'send-on',
                ariaLabel: `Disconnect send ${src.name} → ${dest.name}`,
                title: `Send ${(sendLevel * 100).toFixed(0)}% — click to remove`,
                disabled: false,
                onClick: () => removeSend(src.id, dest.id),
            };
        }

        // FX-2: `setSend` rejects a loop-closing edge outright, so an
        // ordinary-looking cell here would be a control that silently does
        // nothing. Reflect the same verdict the mutation boundary will reach —
        // the boundary stays the invariant, this is only its readout. Scoped to
        // the output/send edges the matrix itself shows; a loop closed through a
        // sidechain key is still caught (and logged) by the guard on click.
        if (wouldCreateRoutingCycle({ sourceId: src.id, targetId: dest.id, tracks })) {
            return {
                kind: 'send-off',
                ariaLabel: `Cannot send ${src.name} → ${dest.name}: would create a feedback loop`,
                title: `${dest.name} already routes back to ${src.name} — a send here would feed the bus into itself`,
                disabled: true,
                onClick: undefined,
            };
        }

        return {
            kind: 'send-off',
            ariaLabel: `Connect send ${src.name} → ${dest.name}`,
            title: `Send ${src.name} → ${dest.name}`,
            disabled: false,
            onClick: () => setSend(src.id, dest.id, NEW_SEND_LEVEL),
        };
    };

    return (
        <DawDiagramFrame
            title="Routing matrix"
            className="h-full"
            footer={
                <div className="text-[10px] text-muted-foreground">
                    Bus cells toggle sends; the cyan glyph marks a track&rsquo;s output routing.
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
                                    if (src.id === dest.id) {
                                        return (
                                            <td key={dest.id} className="p-0.5 text-center border-l border-border/10">
                                                <span className="text-muted-foreground/30">—</span>
                                            </td>
                                        );
                                    }

                                    const cell = describeCell(src, dest);
                                    const isOutput = cell.kind === 'output';

                                    return (
                                        <td key={dest.id} className="p-0.5 text-center border-l border-border/10">
                                            <Button
                                                variant="bare"
                                                size="bare"
                                                type="button"
                                                disabled={cell.disabled}
                                                className={cn(
                                                    'size-4 rounded-sm border transition-colors',
                                                    isOutput
                                                        ? 'bg-[var(--color-state-linked)]/40 border-[var(--color-state-linked)]/60'
                                                        : null,
                                                    cell.kind === 'send-on'
                                                        ? 'bg-[var(--color-state-success)]/40 border-[var(--color-state-success)]/60 hover:bg-[var(--color-state-success)]/50'
                                                        : null,
                                                    cell.kind === 'send-off'
                                                        ? 'bg-muted/10 border-border/20 hover:bg-muted/30'
                                                        : null,
                                                    cell.disabled ? 'cursor-default' : null
                                                )}
                                                onClick={cell.onClick}
                                                aria-label={cell.ariaLabel}
                                                title={cell.title}
                                            >
                                                {isOutput ? (
                                                    <span className="text-[7px] text-[var(--color-state-linked)]">
                                                        ▸
                                                    </span>
                                                ) : null}
                                                {cell.kind === 'send-on' ? (
                                                    <span className="text-[6px] text-[var(--color-state-success)]">
                                                        ●
                                                    </span>
                                                ) : null}
                                            </Button>
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
