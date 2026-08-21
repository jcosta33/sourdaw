/**
 * Per-note parameter editor for the Grand Boule piano (§3.1).
 *
 * Displays 8 physical-modelling parameter knobs for a selected piano key.
 * The user picks a note via a compact dropdown (keys 1–88), then adjusts
 * multipliers for hammer hardness, mass, string stiffness, bridge coupling,
 * damper firmness, sympathetic gain, strike position, and tone brightness.
 *
 * All use-case calls are lifted to callbacks — the component does not import
 * from useCases/ or stores/ directly (respects deps:validate rules).
 */

import { type ReactElement, useState } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

import {
    type GrandBoulePerNoteValues,
    PER_NOTE_PARAM_DESCRIPTORS,
    createDefaultPerNoteValues,
    keyToNoteName,
} from '../../models/GrandBoulePerNoteParams';

type PerNoteEditorProps = {
    /** Called when a per-note parameter changes. */
    onParamChange: (key: number, param: keyof GrandBoulePerNoteValues, value: number) => void;
    /** Called when the user resets all overrides for a key. */
    onReset: (key: number) => void;
    /** Per-note override map for reading current values. */
    perNoteOverrides: ReadonlyMap<number, GrandBoulePerNoteValues>;
    className?: string;
};

/** Build the option list for keys 1–88 (A0 through C8). */
const NOTE_OPTIONS: readonly { value: number; label: string }[] = Array.from({ length: 88 }, (_, i) => {
    const key = i + 1;
    return { value: key, label: `${key} — ${keyToNoteName(key)}` };
});

export const PerNoteEditor = ({
    onParamChange,
    onReset,
    perNoteOverrides,
    className,
}: PerNoteEditorProps): ReactElement => {
    const [selectedKey, setSelectedKey] = useState(40);

    const currentValues = perNoteOverrides.get(selectedKey) ?? createDefaultPerNoteValues();
    const defaults = createDefaultPerNoteValues();
    // Enable Reset only when a value actually deviates from the neutral
    // defaults, not merely because a (possibly all-default) entry exists in
    // the map. A bare `perNoteOverrides.has(selectedKey)` false-positives when
    // the map still holds a functionally-default object.
    const hasOverrides = PER_NOTE_PARAM_DESCRIPTORS.some(
        (descriptor) => currentValues[descriptor.key] !== defaults[descriptor.key]
    );

    return (
        <div className={className}>
            {/* Note selector */}
            <Row gap={2}>
                <DawCompactSelect
                    size="micro"
                    tone="inset"
                    value={selectedKey}
                    onChange={(e) => setSelectedKey(Number(e.currentTarget.value))}
                    className="flex-1 text-[9px]"
                >
                    {NOTE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </DawCompactSelect>
                <button
                    type="button"
                    disabled={!hasOverrides}
                    onClick={() => onReset(selectedKey)}
                    className="rounded px-2 py-0.5 text-[8px] uppercase tracking-[0.16em] text-neutral-300/70 transition-colors hover:bg-neutral-400/10 hover:text-neutral-200 disabled:pointer-events-none disabled:opacity-30"
                >
                    Reset
                </button>
            </Row>

            {/* Parameter knobs — 4×2 grid */}
            <div className="mt-2 grid grid-cols-4 gap-x-2 gap-y-3">
                {PER_NOTE_PARAM_DESCRIPTORS.map((descriptor) => {
                    const value = currentValues[descriptor.key];
                    const isDefault = value === defaults[descriptor.key];

                    return (
                        <Stack align="center" gap={1} key={descriptor.key}>
                            <RotaryKnob
                                value={value}
                                onChange={(next) => onParamChange(selectedKey, descriptor.key, next)}
                                min={descriptor.min}
                                max={descriptor.max}
                                step={descriptor.step}
                                defaultValue={descriptor.defaultValue}
                                size="sm"
                            />
                            <div className="text-center">
                                <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">
                                    {descriptor.label}
                                </div>
                                <div
                                    className={`font-mono text-[9px] ${
                                        isDefault ? 'text-foreground/85' : 'text-neutral-200/90'
                                    }`}
                                >
                                    {value.toFixed(2)}
                                    {descriptor.unit}
                                </div>
                            </div>
                        </Stack>
                    );
                })}
            </div>
        </div>
    );
};
