/**
 * ModulationDock — modulation source tray and active-assignment list.
 *
 * Displays the available mod sources (LFO, Envelope Follower, Lorenz, Step Seq,
 * Macros) with live activity indicators, and lists the patch's existing
 * modulation assignments with a per-row remove control.
 *
 * Scope note: this dock is display + remove only. A drag-to-assign ("drop a
 * source onto a target knob to create an assignment") flow is NOT wired —
 * `BacteriaModAssignment` is currently UI/persistence-only metadata with no
 * frontend engine-bridge message path (see models/BacteriaPatch.ts), so the
 * add path is gated on the same open product decision as the rest of the
 * Lab/dock UI. It is recorded as a deferred decision in
 * the project's findings record (### Bacteria).
 * Until that decision lands, no inert add-path scaffolding is kept here.
 */
import { type ReactElement } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import { type BacteriaPatch } from '../../models/BacteriaPatch';

type ModulationDockProps = {
    patch: BacteriaPatch;
    modValues: number[]; // Real-time mod source values for display
    /** Remove the assignment at `index` from `patch.modAssignments`. */
    onAssignmentRemove: (index: number) => void;
};

const MOD_SOURCES = [
    { id: 'lfo1', label: 'LFO 1', color: 'rgb(244, 63, 94)', icon: '~' },
    { id: 'lfo2', label: 'LFO 2', color: 'rgb(251, 146, 60)', icon: '~' },
    { id: 'env', label: 'Env Follow', color: 'rgb(74, 222, 128)', icon: '▲' },
    { id: 'lorenz', label: 'Lorenz', color: 'rgb(167, 139, 250)', icon: '∞' },
    { id: 'stepseq', label: 'Step Seq', color: 'rgb(96, 165, 250)', icon: '▦' },
    { id: 'macro1', label: 'Macro 1', color: 'rgb(250, 204, 21)', icon: '1' },
    { id: 'macro2', label: 'Macro 2', color: 'rgb(250, 204, 21)', icon: '2' },
    { id: 'macro3', label: 'Macro 3', color: 'rgb(250, 204, 21)', icon: '3' },
    { id: 'macro4', label: 'Macro 4', color: 'rgb(250, 204, 21)', icon: '4' },
];

export const ModulationDock = ({ patch, modValues, onAssignmentRemove }: ModulationDockProps): ReactElement => {
    return (
        <Stack gap={2} className="p-2">
            <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                Modulation Sources
            </div>

            {/* Source pills */}
            <Row align="stretch" wrap gap={1}>
                {MOD_SOURCES.map((source, i) => {
                    const modVal = modValues[i] ?? 0;
                    const activeAssignments = patch.modAssignments.filter((a) => a.sourceId === source.id);

                    return (
                        <Row
                            gap={1}
                            className="px-1.5 py-0.5 rounded text-[7px] font-medium border"
                            key={source.id}
                            style={{
                                borderColor: `${source.color}40`,
                                backgroundColor: `${source.color}10`,
                                color: source.color,
                            }}
                        >
                            <span className="text-[8px] font-bold opacity-60">{source.icon}</span>
                            <span>{source.label}</span>
                            {/* Activity indicator */}
                            <div
                                className="w-1.5 h-1.5 rounded-full"
                                style={{
                                    backgroundColor: source.color,
                                    opacity: 0.3 + Math.abs(modVal) * 0.7,
                                    transform: `scale(${0.8 + Math.abs(modVal) * 0.4})`,
                                }}
                            />
                            {activeAssignments.length > 0 ? (
                                <span className="text-[6px] opacity-50">({activeAssignments.length})</span>
                            ) : null}
                        </Row>
                    );
                })}
            </Row>

            {/* Active assignments list */}
            {patch.modAssignments.length > 0 ? (
                <Stack gap={0.5} className="mt-1">
                    <div className="text-[7px] text-muted-foreground/40 uppercase">Active Assignments</div>
                    {patch.modAssignments.map((assignment, idx) => {
                        const source = MOD_SOURCES.find((s) => s.id === assignment.sourceId);
                        return (
                            <Row gap={1} className="text-[7px]" key={idx}>
                                <span style={{ color: source?.color ?? 'white' }}>
                                    {source?.label ?? assignment.sourceId}
                                </span>
                                <span className="text-muted-foreground/30">→</span>
                                <span className="text-foreground/60">{assignment.targetParam}</span>
                                <span className="text-muted-foreground/40 font-mono">
                                    {assignment.amount > 0 ? '+' : ''}
                                    {(assignment.amount * 100).toFixed(0)}%
                                </span>
                                <Button
                                    variant="bare"
                                    size="bare"
                                    type="button"
                                    className="text-[6px] text-muted-foreground/30 hover:text-red-400 ml-auto"
                                    onClick={() => onAssignmentRemove(idx)}
                                >
                                    ×
                                </Button>
                            </Row>
                        );
                    })}
                </Stack>
            ) : null}
        </Stack>
    );
};
