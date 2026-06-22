/**
 * ModulationDock — drag-and-drop modulation assignment panel.
 *
 * Vital-style modulation source tray where users can drag mod sources
 * (LFO, Envelope Follower, Lorenz, Step Seq, Macros) onto any target
 * parameter knob to create modulation assignments.
 */
import { type DragEvent, type ReactElement, useState } from 'react';

import { type BacteriaPatch, type BacteriaModAssignment } from '../../models/BacteriaPatch';

/**
 * Drag dataTransfer MIME the dock writes the dragged mod-source id under.
 * A target knob reads this on drop to resolve which source is being assigned;
 * exported so the drop target shares the exact key rather than a stringly-typed
 * literal that could silently drift.
 */
export const BACTERIA_MOD_SOURCE_DRAG_TYPE = 'application/x-bacteria-mod-source';

type ModulationDockProps = {
    patch: BacteriaPatch;
    modValues: number[]; // Real-time mod source values for display
    /**
     * Called when a source is dropped onto a target parameter to create an
     * assignment. Modulation assignments are UI/persistence-only metadata
     * (see BacteriaModAssignment): the dock hands the dropped source's id to
     * the target knob via the HTML5 drag dataTransfer, and the *knob* (the drop
     * target) invokes this callback with the resolved `targetParam`. The host
     * is then responsible for writing the result into `patch.modAssignments`
     * via a use-case. The dock does not call this itself — it only originates
     * the drag.
     */
    onAssignmentAdd: (assignment: BacteriaModAssignment) => void;
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

export const ModulationDock = ({
    patch,
    modValues,
    onAssignmentAdd: _onAssignmentAdd,
    onAssignmentRemove,
}: ModulationDockProps): ReactElement => {
    const [dragSource, setDragSource] = useState<string | null>(null);

    const handleDragStart = (event: DragEvent<HTMLButtonElement>, sourceId: string): void => {
        // Carry the source id on the drag so a target knob can read it on drop
        // and report the assignment through onAssignmentAdd. Without this the
        // drag had no payload and the assignment flow was unreachable at its origin.
        event.dataTransfer.setData(BACTERIA_MOD_SOURCE_DRAG_TYPE, sourceId);
        event.dataTransfer.effectAllowed = 'link';
        setDragSource(sourceId);
    };

    const handleDragEnd = (): void => {
        setDragSource(null);
    };

    return (
        <div className="flex flex-col gap-2 p-2">
            <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                Modulation Sources
            </div>

            {/* Source pills */}
            <div className="flex flex-wrap gap-1">
                {MOD_SOURCES.map((source, i) => {
                    const modVal = modValues[i] ?? 0;
                    const activeAssignments = patch.modAssignments.filter((a) => a.sourceId === source.id);

                    return (
                        <button
                            key={source.id}
                            type="button"
                            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-medium border transition-all cursor-grab active:cursor-grabbing ${
                                dragSource === source.id ? 'ring-1 ring-white/30 scale-105' : ''
                            }`}
                            style={{
                                borderColor: `${source.color}40`,
                                backgroundColor: `${source.color}10`,
                                color: source.color,
                            }}
                            draggable
                            onDragStart={(event) => handleDragStart(event, source.id)}
                            onDragEnd={handleDragEnd}
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
                        </button>
                    );
                })}
            </div>

            {/* Active assignments list */}
            {patch.modAssignments.length > 0 ? (
                <div className="space-y-0.5 mt-1">
                    <div className="text-[7px] text-muted-foreground/40 uppercase">Active Assignments</div>
                    {patch.modAssignments.map((assignment, idx) => {
                        const source = MOD_SOURCES.find((s) => s.id === assignment.sourceId);
                        return (
                            <div key={idx} className="flex items-center gap-1 text-[7px]">
                                <span style={{ color: source?.color ?? 'white' }}>
                                    {source?.label ?? assignment.sourceId}
                                </span>
                                <span className="text-muted-foreground/30">→</span>
                                <span className="text-foreground/60">{assignment.targetParam}</span>
                                <span className="text-muted-foreground/40 font-mono">
                                    {assignment.amount > 0 ? '+' : ''}
                                    {(assignment.amount * 100).toFixed(0)}%
                                </span>
                                <button
                                    type="button"
                                    className="text-[6px] text-muted-foreground/30 hover:text-red-400 ml-auto"
                                    onClick={() => onAssignmentRemove(idx)}
                                >
                                    ×
                                </button>
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
};
