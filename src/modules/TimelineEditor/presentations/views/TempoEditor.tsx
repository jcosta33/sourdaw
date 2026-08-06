import { type ReactElement } from 'react';

import { Lock, Map, Plus, Trash2 } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { ValueField } from '#/components/daw/ValueField';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/utils/Styles/cn';

import { useTempoEditorState } from '../hooks/useTempoEditorState';

export const TempoEditor = (): ReactElement => {
    const time = useTempoEditorState();

    // With a tempo map the field reads out the map's value at the playhead and
    // edits the event governing it, so say so rather than let it look like a
    // free-standing project tempo. Where it cannot write that event, it says
    // that too instead of leaving a control that writes somewhere else.
    const tempoField = time.tempoField;
    let tempoFieldLabel = 'Tempo BPM';
    let tempoFieldHint = 'Drag up/down to adjust, arrows to step, double-click to reset, Shift for fine.';
    if (tempoField.governedByMap) {
        tempoFieldLabel = 'Tempo BPM at playhead (tempo map)';
        tempoFieldHint = 'Tempo at the playhead. Editing changes the tempo-map event that governs it.';
    }

    // The lock reason is rendered as a visible badge beside the field, not left
    // to the tooltip: the tooltip is hover-only, so touch and keyboard users
    // never see it, and it was carrying the entire explanation.
    let tempoLockBadge: string | null = null;
    if (tempoField.lockReason === 'tempo-ramp') {
        tempoFieldLabel = 'Tempo BPM at playhead (tempo ramp, read-only)';
        tempoFieldHint = 'The playhead is inside a tempo ramp. Edit its end points in the tempo map.';
        tempoLockBadge = 'ramp';
    }
    if (tempoField.lockReason === 'no-transport-state') {
        tempoFieldLabel = 'Tempo BPM (transport state loading, read-only)';
        tempoFieldHint = 'The transport state has not loaded yet.';
        tempoLockBadge = 'loading';
    }

    return (
        <div className="daw-readout-well relative flex h-8 items-center gap-2 rounded-sm px-2">
            <Tooltip>
                <TooltipTrigger asChild>
                    <div>
                        <ValueField
                            value={tempoField.tempo}
                            onChange={time.setTempoValue}
                            onReset={time.resetTempoValue ?? undefined}
                            readOnly={!tempoField.editable}
                            ariaLabel={tempoFieldLabel}
                            commitMode="release"
                            min={tempoField.minTempo}
                            max={tempoField.maxTempo}
                            step={1}
                            fineStep={0.01}
                            unit=" BPM"
                            className="w-16"
                        />
                    </div>
                </TooltipTrigger>
                <TooltipContent>{tempoFieldHint}</TooltipContent>
            </Tooltip>
            {tempoLockBadge === null ? null : (
                <span
                    data-testid="tempo-lock-reason"
                    className="flex items-center gap-0.5 text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
                >
                    <Lock className="size-2.5" aria-hidden="true" />
                    {tempoLockBadge}
                </span>
            )}
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => time.setMapOpen(!time.mapOpen)}
                        aria-label="Toggle tempo map"
                        aria-expanded={time.mapOpen}
                        className={cn('size-5', time.mapOpen && 'bg-accent')}
                    >
                        <Map className="size-3" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Tempo map</TooltipContent>
            </Tooltip>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={time.handleTapTempo}
                        aria-label="Tap tempo"
                        // Tap tempo writes through the same field, so it lands
                        // wherever the field lands — and refuses wherever the
                        // field refuses. It stays live during playback, the state
                        // tap tempo is most for; under a lock it is visibly
                        // disabled rather than silently doing nothing.
                        disabled={!tempoField.editable}
                        className="text-[9px] font-bold w-6 h-5"
                    >
                        TAP
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{tempoField.editable ? 'Tap to set tempo' : tempoFieldHint}</TooltipContent>
            </Tooltip>
            {time.editingTimeSig ? (
                <div className="flex items-center gap-0.5">
                    <DawCompactInput
                        type="number"
                        value={time.numValue}
                        onChange={(event) => time.setNumValue(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                time.commitTimeSig();
                            }
                            if (event.key === 'Escape') {
                                time.cancelTimeSigEdit();
                            }
                        }}
                        size="micro"
                        align="center"
                        monospace
                        className="w-8"
                        min={1}
                        max={32}
                        autoFocus
                        aria-label="Time signature numerator"
                    />
                    <span className="text-xs text-muted-foreground">/</span>
                    <DawCompactSelect
                        value={time.denValue}
                        onChange={(event) => time.setDenValue(event.target.value)}
                        onBlur={time.commitTimeSig}
                        align="center"
                        className="w-10 font-mono"
                        aria-label="Time signature denominator"
                    >
                        <option value="2">2</option>
                        <option value="4">4</option>
                        <option value="8">8</option>
                        <option value="16">16</option>
                    </DawCompactSelect>
                </div>
            ) : (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={time.startTimeSigEdit}
                            aria-label={`Time signature: ${time.transport.timeSignatureNumerator}/${time.transport.timeSignatureDenominator}. Click to edit.`}
                            className="px-2 py-0.5"
                        >
                            <span className="text-lg font-mono font-medium text-muted-foreground">
                                {time.transport.timeSignatureNumerator}/{time.transport.timeSignatureDenominator}
                            </span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Click to edit time signature</TooltipContent>
                </Tooltip>
            )}
            {time.mapOpen ? (
                <div
                    ref={time.mapPanelRef}
                    role="dialog"
                    aria-label="Tempo map editor"
                    className="daw-floating-surface absolute left-0 top-full z-50 mt-1 w-72 rounded-md p-2"
                >
                    <h3 className="mb-1.5 text-xs font-semibold text-foreground">Tempo Map</h3>

                    {time.tempoMap.changes.length === 0 ? (
                        <p className="py-2 text-center text-xs text-muted-foreground">No tempo changes</p>
                    ) : (
                        <div className="max-h-40 space-y-0.5 overflow-y-auto">
                            {time.tempoMap.changes.map((change) => (
                                <div
                                    key={change.id}
                                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent/30"
                                >
                                    <span className="w-12 shrink-0 font-mono tabular-nums text-muted-foreground">
                                        Beat {change.beat}
                                    </span>

                                    {time.editingChangeId === change.id ? (
                                        <DawCompactInput
                                            type="number"
                                            value={time.editingChangeTempo}
                                            onChange={(event) => time.setEditingChangeTempo(event.target.value)}
                                            onBlur={time.commitEditChange}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    time.commitEditChange();
                                                }
                                                if (event.key === 'Escape') {
                                                    time.cancelEditChange();
                                                }
                                            }}
                                            size="micro"
                                            align="center"
                                            monospace
                                            className="h-5 w-14"
                                            min={20}
                                            max={999}
                                            step={0.1}
                                            autoFocus
                                            aria-label={`Edit tempo at beat ${change.beat}`}
                                        />
                                    ) : (
                                        <Button
                                            variant="ghost"
                                            size="xs"
                                            className="w-14 text-center font-mono tabular-nums"
                                            onClick={() => time.startEditChange(change)}
                                            aria-label={`${change.tempo} BPM at beat ${change.beat}. Click to edit.`}
                                        >
                                            {change.tempo}
                                        </Button>
                                    )}

                                    <span className="text-muted-foreground">BPM</span>

                                    <span
                                        className={cn(
                                            'rounded px-1 py-0.5 text-[10px]',
                                            change.curve === 'linear'
                                                ? 'bg-[var(--color-accent-cyan)]/20 text-[var(--color-accent-cyan)]'
                                                : 'bg-muted text-muted-foreground'
                                        )}
                                    >
                                        {change.curve}
                                    </span>

                                    <Button
                                        variant="ghost"
                                        size="icon-xs"
                                        className="ml-auto size-5 text-muted-foreground hover:text-destructive"
                                        onClick={() => time.removeChange(change.id)}
                                        aria-label={`Remove tempo change at beat ${change.beat}`}
                                    >
                                        <Trash2 className="size-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
                        <DawCompactInput
                            type="number"
                            value={time.newBeat}
                            onChange={(event) => time.setNewBeat(event.target.value)}
                            size="micro"
                            align="center"
                            monospace
                            className="w-14"
                            min={0}
                            step={1}
                            placeholder="Beat"
                            aria-label="New tempo change beat"
                        />
                        <DawCompactInput
                            type="number"
                            value={time.newTempo}
                            onChange={(event) => time.setNewTempo(event.target.value)}
                            size="micro"
                            align="center"
                            monospace
                            className="w-14"
                            min={20}
                            max={999}
                            step={0.1}
                            placeholder="BPM"
                            aria-label="New tempo change BPM"
                        />
                        <DawCompactSelect
                            value={time.newCurve}
                            onChange={(event) => time.setNewCurve(event.target.value as 'instant' | 'linear')}
                            className="bg-muted px-1"
                            aria-label="New tempo change curve type"
                        >
                            <option value="instant">instant</option>
                            <option value="linear">linear</option>
                        </DawCompactSelect>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={time.handleAddTempoChange}
                            aria-label="Add tempo change"
                            className="size-6"
                        >
                            <Plus className="size-3" />
                        </Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
};
