/**
 * ProofEqSection — 8-band parametric EQ with interactive controls.
 * Knobs for freq/gain/Q per band, band type selector, M/S per-band.
 */
import { type ReactElement, useLayoutEffect, useReducer, useRef } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';

import { getProofPatchSnapshot, type ProofPatch, type ProofPatchEdit } from '../../models/ProofPatch';

import { ProofEqCurve } from './ProofEqCurve';

const BAND_TYPES = ['Peak', 'Lo Shelf', 'Hi Shelf', 'HP', 'LP'] as const;
const CHANNEL_MODES = ['L/R', 'Mid', 'Side'] as const;
const EQ_BAND_KEYS = ['low-cut', 'low-shelf', 'low-mid', 'mid', 'high-mid', 'high', 'high-shelf', 'high-cut'] as const;
const BAND_COLORS = ['#6BAACE', '#52BA46', '#E0AA2A', '#FF5F80', '#4CB8B8', '#954EB2', '#6BAACE', '#52BA46'];

type Props = {
    patch: ProofPatch;
    onPatchChange: (edit: ProofPatchEdit) => void;
};

export const ProofEqSection = ({ patch, onPatchChange }: Props): ReactElement => {
    const [gestureOwner, incrementGestureOwner] = useReducer((currentOwner: number) => currentOwner + 1, 0);
    const patchSnapshotRef = useRef(getProofPatchSnapshot(patch));
    const acceptedTransientPatchSnapshotRef = useRef<string | null>(null);
    const patchSnapshot = getProofPatchSnapshot(patch);
    useLayoutEffect(() => {
        const previousPatchSnapshot = patchSnapshotRef.current;
        patchSnapshotRef.current = patchSnapshot;
        const acceptedTransient = acceptedTransientPatchSnapshotRef.current === patchSnapshot;
        acceptedTransientPatchSnapshotRef.current = null;
        if (previousPatchSnapshot !== patchSnapshot && !acceptedTransient) {
            incrementGestureOwner();
        }
    }, [patchSnapshot]);

    const updatePatch = <Key extends keyof ProofPatch['eqBands'][number]>(
        idx: number,
        key: Key,
        value: ProofPatch['eqBands'][number][Key],
        isTransient = false
    ) => {
        const bands = patch.eqBands.map((band, index) => (index === idx ? { ...band, [key]: value } : band));
        if (isTransient) {
            acceptedTransientPatchSnapshotRef.current = getProofPatchSnapshot({ ...patch, eqBands: bands });
        }
        onPatchChange({
            key: 'eqBands',
            value: bands,
            changedParams: [{ bandIndex: idx, field: key }],
            isTransient,
        });
    };

    return (
        <div className="flex flex-col gap-1.5 px-2">
            <DawPluginSectionHeader
                title="EQ"
                size="xs"
                titleClassName="text-[var(--color-accent-cyan)]"
                actions={
                    <DawPluginToggle
                        pressed={!patch.eqBypassed}
                        tone="cyan"
                        size="xs"
                        onClick={() => {
                            const value = !patch.eqBypassed;
                            onPatchChange({
                                key: 'eqBypassed',
                                value,
                                isTransient: false,
                            });
                        }}
                    >
                        {patch.eqBypassed ? 'OFF' : 'ON'}
                    </DawPluginToggle>
                }
            />

            {/* Interactive frequency response graph */}
            <div className={patch.eqBypassed ? 'opacity-30' : ''}>
                <ProofEqCurve patch={patch} width={500} height={120} onPatchChange={onPatchChange} />
            </div>

            <div className={`flex gap-1 overflow-x-auto ${patch.eqBypassed ? 'opacity-30' : ''}`}>
                {patch.eqBands.map((band, i) => (
                    <div
                        key={EQ_BAND_KEYS[i]}
                        className="flex flex-col items-center gap-0.5 min-w-[52px] px-0.5 py-1 rounded bg-surface-base/50"
                    >
                        {/* Enable toggle */}
                        <button
                            type="button"
                            className={`w-2 h-2 rounded-full cursor-pointer ${band.enabled ? '' : 'opacity-20'}`}
                            style={{ backgroundColor: BAND_COLORS[i] }}
                            onClick={() => {
                                const next = !band.enabled;
                                updatePatch(i, 'enabled', next);
                            }}
                        />

                        {/* Frequency */}
                        <RotaryKnob
                            value={band.freq}
                            onChange={(value, isTransient) => updatePatch(i, 'freq', value, isTransient)}
                            gestureOwner={gestureOwner}
                            min={20}
                            max={20000}
                            step={1}
                            defaultValue={band.freq}
                            size="sm"
                            tone="cyan"
                        />
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {band.freq >= 1000 ? `${(band.freq / 1000).toFixed(1)}k` : `${band.freq.toFixed(0)}`}
                        </span>

                        {/* Gain */}
                        <RotaryKnob
                            value={band.gain}
                            onChange={(value, isTransient) => updatePatch(i, 'gain', value, isTransient)}
                            gestureOwner={gestureOwner}
                            min={-18}
                            max={18}
                            step={0.5}
                            defaultValue={0}
                            size="sm"
                            tone="cyan"
                        />
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {band.gain > 0 ? '+' : ''}
                            {band.gain.toFixed(1)}
                        </span>

                        {/* Q */}
                        <RotaryKnob
                            value={band.q}
                            onChange={(value, isTransient) => updatePatch(i, 'q', value, isTransient)}
                            gestureOwner={gestureOwner}
                            min={0.1}
                            max={10}
                            step={0.1}
                            defaultValue={1}
                            tone="cyan"
                            size="sm"
                        />
                        <span className="text-[6px] text-muted-foreground font-mono">Q{band.q.toFixed(1)}</span>

                        {/* Band type */}
                        <DawCompactSelect
                            size="micro"
                            tone="inset"
                            className="w-full text-[6px]"
                            value={band.type}
                            onChange={(event) => updatePatch(i, 'type', Number.parseInt(event.target.value, 10))}
                        >
                            {BAND_TYPES.map((label, ti) => (
                                <option key={label} value={ti}>
                                    {label}
                                </option>
                            ))}
                        </DawCompactSelect>

                        {/* M/S channel */}
                        <DawCompactSelect
                            size="micro"
                            tone="inset"
                            className="w-full text-[6px]"
                            value={band.channel}
                            onChange={(event) => updatePatch(i, 'channel', Number.parseInt(event.target.value, 10))}
                        >
                            {CHANNEL_MODES.map((label, ci) => (
                                <option key={label} value={ci}>
                                    {label}
                                </option>
                            ))}
                        </DawCompactSelect>
                    </div>
                ))}
            </div>
        </div>
    );
};
