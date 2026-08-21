import { type ChangeEvent, type ReactElement, useState } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';

import {
    DEFAULT_MACRO_MAPPINGS,
    FERMENTER_PARAMS,
    MACRO_LABELS,
    type FermenterMacroMapping,
    type FermenterMacroTarget,
    type FermenterPatch,
} from '../../models/FermenterPatch';

type MacroMatrixEditorProps = {
    mappings?: readonly FermenterMacroMapping[];
    onChange: (macroIndex: number, mappings: FermenterMacroMapping[]) => void;
};

const MAX_TARGETS_PER_MACRO = 3;

const editableParams = FERMENTER_PARAMS.filter((param) => !param.step);

function normalizeMappings(mappings: readonly FermenterMacroMapping[] | undefined): FermenterMacroMapping[] {
    return MACRO_LABELS.map((_, index) => ({
        targets: [...(mappings?.[index]?.targets ?? DEFAULT_MACRO_MAPPINGS[index]?.targets ?? [])],
    }));
}

function createTarget(paramId: string): FermenterMacroTarget {
    const param = editableParams.find((entry) => entry.id === paramId) ?? editableParams[0];
    const min = param?.min ?? 0;
    const max = param?.max ?? 1;
    const center = param?.default ?? min + (max - min) / 2;

    return {
        target: (param?.id ?? 'filterCutoff') as keyof FermenterPatch,
        center,
        depth: (max - min) / 2,
        min,
        max,
        curve: param?.scaling === 'log' ? 'exponential' : 'linear',
    };
}

function updateTarget({
    mappings,
    macroIndex,
    targetIndex,
    target,
}: {
    mappings: FermenterMacroMapping[];
    macroIndex: number;
    targetIndex: number;
    target: FermenterMacroTarget;
}): FermenterMacroMapping[] {
    return mappings.map((mapping, index) => {
        if (index !== macroIndex) {
            return mapping;
        }
        const targets = mapping.targets.map((entry, entryIndex) => (entryIndex === targetIndex ? target : entry));
        return { targets };
    });
}

function NumberField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
}): ReactElement {
    return (
        <Stack as="label" gap={1}>
            <span className="text-[7px] uppercase tracking-[0.18em] text-muted-foreground/55">{label}</span>
            <Input
                type="number"
                value={Number.isFinite(value) ? value : 0}
                onChange={(event) => onChange(Number(event.target.value))}
                className="h-7 rounded border border-border/30 bg-surface-inset px-2 text-[10px] text-foreground"
            />
        </Stack>
    );
}

export function MacroMatrixEditor({ mappings, onChange }: MacroMatrixEditorProps): ReactElement {
    const [selectedMacro, setSelectedMacro] = useState(0);
    const normalizedMappings = normalizeMappings(mappings);
    const mapping = normalizedMappings[selectedMacro] ?? { targets: [] };

    function emit(nextMappings: FermenterMacroMapping[]): void {
        onChange(selectedMacro, nextMappings);
    }

    function addTarget(): void {
        const firstParam = editableParams[0];
        if (mapping.targets.length >= MAX_TARGETS_PER_MACRO || !firstParam) {
            return;
        }
        emit(
            normalizedMappings.map((entry, index) => {
                if (index !== selectedMacro) {
                    return entry;
                }
                return { targets: [...entry.targets, createTarget(firstParam.id)] };
            })
        );
    }

    function removeTarget(targetIndex: number): void {
        emit(
            normalizedMappings.map((entry, index) => {
                if (index !== selectedMacro) {
                    return entry;
                }
                return { targets: entry.targets.filter((_, entryIndex) => entryIndex !== targetIndex) };
            })
        );
    }

    function setTarget(targetIndex: number, target: FermenterMacroTarget): void {
        emit(updateTarget({ mappings: normalizedMappings, macroIndex: selectedMacro, targetIndex, target }));
    }

    return (
        <Stack gap={3} className="border-t border-border/15 pt-3">
            <Row justify="between" gap={2}>
                <div>
                    <div className="text-[8px] font-semibold uppercase tracking-[0.24em] text-[var(--color-accent-sage)]/70">
                        Matrix
                    </div>
                    <div className="text-[10px] text-muted-foreground/70">Assign macro targets</div>
                </div>
                <DawCompactSelect
                    aria-label="Macro"
                    value={selectedMacro}
                    onChange={(event) => setSelectedMacro(Number(event.target.value))}
                    className="h-7 rounded border border-border/30 bg-surface-inset px-2 text-[10px] text-foreground"
                >
                    {MACRO_LABELS.map((label, index) => (
                        <option key={label} value={index}>
                            {label}
                        </option>
                    ))}
                </DawCompactSelect>
            </Row>

            <Stack gap={2}>
                {mapping.targets.map((target, targetIndex) => (
                    <div
                        key={`${target.target}-${targetIndex}`}
                        className="rounded-lg border border-border/20 bg-black/15 p-2"
                    >
                        <Row gap={2}>
                            <DawCompactSelect
                                aria-label={`Target ${targetIndex + 1}`}
                                value={String(target.target)}
                                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                                    setTarget(targetIndex, createTarget(event.target.value));
                                }}
                                className="min-w-0 flex-1 rounded border border-border/30 bg-surface-inset px-2 py-1 text-[10px] text-foreground"
                            >
                                {editableParams.map((param) => (
                                    <option key={param.id} value={param.id}>
                                        {param.label}
                                    </option>
                                ))}
                            </DawCompactSelect>
                            <Button
                                variant="bare"
                                size="bare"
                                type="button"
                                onClick={() => removeTarget(targetIndex)}
                                className="rounded border border-border/30 px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-muted-foreground hover:text-foreground"
                            >
                                Clear
                            </Button>
                        </Row>

                        <Grid cols={2} gap={2} className="mt-2">
                            <NumberField
                                label="Center"
                                value={target.center}
                                onChange={(value) => setTarget(targetIndex, { ...target, center: value })}
                            />
                            <NumberField
                                label="Depth"
                                value={target.depth}
                                onChange={(value) => setTarget(targetIndex, { ...target, depth: value })}
                            />
                            <NumberField
                                label="Min"
                                value={target.min}
                                onChange={(value) => setTarget(targetIndex, { ...target, min: value })}
                            />
                            <NumberField
                                label="Max"
                                value={target.max}
                                onChange={(value) => setTarget(targetIndex, { ...target, max: value })}
                            />
                        </Grid>

                        <Stack as="label" gap={1} className="mt-2">
                            <span className="text-[7px] uppercase tracking-[0.18em] text-muted-foreground/55">
                                Curve
                            </span>
                            <DawCompactSelect
                                value={target.curve}
                                onChange={(event) =>
                                    setTarget(targetIndex, {
                                        ...target,
                                        curve: event.target.value === 'exponential' ? 'exponential' : 'linear',
                                    })
                                }
                                className="h-7 rounded border border-border/30 bg-surface-inset px-2 text-[10px] text-foreground"
                            >
                                <option value="linear">Linear</option>
                                <option value="exponential">Exponential</option>
                            </DawCompactSelect>
                        </Stack>
                    </div>
                ))}
            </Stack>

            <Button
                variant="bare"
                size="bare"
                type="button"
                onClick={addTarget}
                disabled={mapping.targets.length >= MAX_TARGETS_PER_MACRO}
                className="w-full rounded border border-dashed border-border/40 px-2 py-2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground transition hover:border-[var(--color-accent-sage)]/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
                Add target
            </Button>
        </Stack>
    );
}
