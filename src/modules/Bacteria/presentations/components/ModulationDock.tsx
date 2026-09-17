/**
 * ModulationDock — modulation source tray, add flow, and active-assignment list.
 *
 * Displays the available mod sources (LFO, Envelope Follower, Lorenz, Step Seq,
 * Macros) with live activity indicators, adds a source → target routing with a
 * depth slider, and lists the patch's existing modulation assignments with a
 * per-row remove control. Adding and removing both go through the caller's
 * handler, which replaces the whole assignment table in the store and the
 * engine (see `setBacteriaModAssignmentsWithAudio`).
 */
import { type ReactElement, useState } from 'react';

import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';

import {
    bacteriaModulationTargetChoices,
    type BacteriaModulationTargetChoice,
} from '../../models/BacteriaModulationIds';
import { type BacteriaModAssignment, type BacteriaPatch } from '../../models/BacteriaPatch';

/** Maximum rows the engine's assignment table accepts; past this a push is rejected whole. */
const MAX_ASSIGNMENTS = 64;

/** Depth slider default: half of the target's usable range. */
const DEFAULT_AMOUNT = 0.5;

type ModulationDockProps = {
    patch: BacteriaPatch;
    modValues: number[]; // Real-time mod source values for display
    /** Replace the whole assignment list with the caller's next table. */
    onAssignmentAdd: (assignment: BacteriaModAssignment) => void;
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
] as const;

type ModSourceId = (typeof MOD_SOURCES)[number]['id'];

/** Sources whose native output swings both ways; the rest rest at zero, not centre. */
const BIPOLAR_SOURCES: ReadonlySet<string> = new Set<ModSourceId>(['lfo1', 'lfo2', 'env', 'lorenz']);

const selectClasses = 'h-5 rounded-micro border border-border-soft bg-black/30 px-1 text-nano text-foreground/80';

function SourcePills({ patch, modValues }: { patch: BacteriaPatch; modValues: number[] }): ReactElement {
    return (
        <Row align="stretch" wrap gap={1}>
            {MOD_SOURCES.map((source, i) => {
                const modVal = modValues[i] ?? 0;
                const activeAssignments = patch.modAssignments.filter((a) => a.sourceId === source.id);

                return (
                    <Row
                        gap={1}
                        className="px-1.5 py-0.5 rounded text-nano font-medium border"
                        key={source.id}
                        style={{
                            borderColor: `${source.color}40`,
                            backgroundColor: `${source.color}10`,
                            color: source.color,
                        }}
                    >
                        <span className="text-micro font-bold opacity-60">{source.icon}</span>
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
    );
}

/** One row of the add flow: source → target with a depth of the target's usable range. */
function AddAssignmentRow({
    targets,
    disabled,
    onAdd,
}: {
    targets: BacteriaModulationTargetChoice[];
    disabled: boolean;
    onAdd: (assignment: BacteriaModAssignment) => void;
}): ReactElement {
    const [sourceId, setSourceId] = useState<ModSourceId>('lfo1');
    const [targetParam, setTargetParam] = useState(targets[0]?.id ?? 'mix');
    const [amount, setAmount] = useState(DEFAULT_AMOUNT);
    const addTarget = targets.find((choice) => choice.id === targetParam) ?? targets[0];

    return (
        <Row wrap gap={1} className="mt-1 items-center">
            <select
                aria-label="Modulation source"
                className={selectClasses}
                value={sourceId}
                onChange={(event) => setSourceId(event.target.value as ModSourceId)}
            >
                {MOD_SOURCES.map((source) => (
                    <option key={source.id} value={source.id}>
                        {source.label}
                    </option>
                ))}
            </select>
            <span className="text-nano text-muted-foreground/40">→</span>
            <select
                aria-label="Modulation target"
                className={selectClasses}
                value={addTarget?.id}
                onChange={(event) => setTargetParam(event.target.value)}
            >
                {targets.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                        {choice.label}
                    </option>
                ))}
            </select>
            <input
                aria-label="Modulation depth"
                type="range"
                min={-1}
                max={1}
                step={0.05}
                value={amount}
                className="w-20 accent-accent-cyan"
                onChange={(event) => setAmount(Number(event.target.value))}
            />
            <span className="text-nano text-muted-foreground/40 font-mono">
                {amount > 0 ? '+' : ''}
                {(amount * 100).toFixed(0)}%
            </span>
            <Button
                variant="secondary"
                size="xs"
                type="button"
                disabled={disabled}
                onClick={() => {
                    if (!addTarget) {
                        return;
                    }
                    onAdd({
                        sourceId,
                        targetParam: addTarget.id,
                        amount,
                        bipolar: BIPOLAR_SOURCES.has(sourceId),
                    });
                    setAmount(DEFAULT_AMOUNT);
                }}
            >
                Add
            </Button>
        </Row>
    );
}

function AssignmentRow({
    assignment,
    onRemove,
}: {
    assignment: BacteriaModAssignment;
    onRemove: () => void;
}): ReactElement {
    const source = MOD_SOURCES.find((s) => s.id === assignment.sourceId);
    return (
        <Row gap={1} className="text-nano">
            <span style={{ color: source?.color ?? 'white' }}>{source?.label ?? assignment.sourceId}</span>
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
                onClick={onRemove}
            >
                ×
            </Button>
        </Row>
    );
}

export const ModulationDock = ({
    patch,
    modValues,
    onAssignmentAdd,
    onAssignmentRemove,
}: ModulationDockProps): ReactElement => {
    const targets = bacteriaModulationTargetChoices(patch.bandCount);

    return (
        <Stack gap={2} className="p-2">
            <div className="text-micro text-muted-foreground/50 font-medium uppercase tracking-wider">
                Modulation Sources
            </div>

            <SourcePills patch={patch} modValues={modValues} />

            <AddAssignmentRow
                targets={targets}
                disabled={patch.modAssignments.length >= MAX_ASSIGNMENTS}
                onAdd={onAssignmentAdd}
            />

            {patch.modAssignments.length > 0 ? (
                <Stack gap={0.5} className="mt-1">
                    <div className="text-nano text-muted-foreground/40 uppercase">Active Assignments</div>
                    {patch.modAssignments.map((assignment, idx) => (
                        <AssignmentRow key={idx} assignment={assignment} onRemove={() => onAssignmentRemove(idx)} />
                    ))}
                </Stack>
            ) : null}
        </Stack>
    );
};
