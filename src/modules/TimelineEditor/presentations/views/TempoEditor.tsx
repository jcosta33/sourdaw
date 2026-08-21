import { type ReactElement } from 'react';

import { Lock, Map, Plus, Trash2 } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { ValueField } from '#/components/daw/ValueField';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/utils/Styles/cn';

import { useTempoEditorState } from '../hooks/useTempoEditorState';

const TEMPO_FIELD_DESCRIPTION_ID = 'tempo-field-description';
const TEMPO_FIELD_LABEL = 'Tempo BPM';

export const TempoEditor = (): ReactElement => {
    const time = useTempoEditorState();

    // Keep the accessible name stable for voice control. The tooltip,
    // description, read-only state, visible badge, and live status carry the
    // changing map and lock context.
    const tempoField = time.tempoField;
    let tempoFieldHint = 'Drag up/down to adjust, arrows to step, double-click to reset, Shift for fine.';
    if (tempoField.governedByMap) {
        tempoFieldHint = 'Tempo at the playhead. Editing changes the tempo-map event that governs it.';
    }

    // The lock reason is rendered as a visible badge beside the field, not left
    // to the tooltip: the tooltip is hover-only, so touch and keyboard users
    // never see it, and it was carrying the entire explanation.
    let tempoLockBadge: string | null = null;
    /**
     * Announced while the lock holds, and only then. Deliberately not a third
     * copy of `tempoFieldHint`: the hint is instructions, and a user who hears
     * "edit its end points in the tempo map" arriving unprompted has not been
     * told the thing that just happened. A status message names the control and
     * the transition. Clearing it does not announce, which is what keeps this
     * quiet on mount and on unlock.
     */
    let tempoFieldStatus = '';
    if (tempoField.lockReason === 'tempo-ramp') {
        tempoFieldHint = 'The playhead is inside a tempo ramp. Edit its end points in the tempo map.';
        tempoLockBadge = 'ramp';
        tempoFieldStatus = 'Tempo field locked: the playhead is inside a tempo ramp.';
    }
    if (tempoField.lockReason === 'no-transport-state') {
        tempoFieldHint = 'The transport state has not loaded yet.';
        tempoLockBadge = 'loading';
        tempoFieldStatus = 'Tempo field locked: the transport state has not loaded yet.';
    }
    const tempoFieldDescription = tempoField.governedByMap || tempoField.lockReason !== null ? tempoFieldHint : '';

    return (
        <Row gap={2} className="daw-readout-well relative h-8 rounded-sm px-2">
            {/*
             * The lock arriving is a status message, and it was not one. The badge
             * below names the reason but is referenced by nothing, and
             * `aria-readonly` flipping is not announced — so a screen-reader,
             * magnifier or voice-control user got a field that silently stopped
             * responding while its number silently changed. `aria-valuenow` is not
             * the signal: it already moves every animation frame off the playhead,
             * measured at 146/142/138/134/130/126 across six frames inside a ramp
             * with no drag at all, so the abort's revert is indistinguishable from
             * tracking. WCAG 4.1.3. Same `sr-only` status pattern as
             * `TransportControls`, in the same transport bar.
             */}
            <span className="sr-only" aria-live="polite" role="status">
                {tempoFieldStatus}
            </span>
            <span id={TEMPO_FIELD_DESCRIPTION_ID} className="sr-only">
                {tempoFieldDescription}
            </span>
            <Tooltip>
                <TooltipTrigger asChild>
                    <div data-testid="transport-tempo-bpm">
                        <ValueField
                            value={tempoField.tempo}
                            onChange={time.setTempoValue}
                            onReset={time.resetTempoValue ?? undefined}
                            readOnly={!tempoField.editable}
                            ariaLabel={TEMPO_FIELD_LABEL}
                            ariaDescribedBy={tempoFieldDescription === '' ? undefined : TEMPO_FIELD_DESCRIPTION_ID}
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
                <Row
                    as="span"
                    gap={0.5}
                    className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground"
                    data-testid="tempo-lock-reason"
                >
                    <Lock className="size-2.5" aria-hidden="true" />
                    {tempoLockBadge}
                </Row>
            )}
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => time.setMapOpen(!time.mapOpen)}
                        aria-label="Toggle tempo map"
                        aria-expanded={time.mapOpen}
                        data-testid="transport-tempo-map-toggle"
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
                        onClick={() => {
                            if (!tempoField.editable) {
                                return;
                            }
                            time.handleTapTempo();
                        }}
                        aria-label="Tap tempo"
                        // Tap tempo writes through the same field, so it lands
                        // wherever the field lands — and refuses wherever the
                        // field refuses. It stays live during playback, the state
                        // tap tempo is most for; under a lock it is visibly
                        // unavailable without dropping keyboard focus.
                        aria-disabled={!tempoField.editable || undefined}
                        className="text-[9px] font-bold w-6 h-5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-text-secondary aria-disabled:active:translate-y-0 aria-disabled:active:border-0 aria-disabled:active:[background:none] aria-disabled:active:shadow-none"
                    >
                        TAP
                    </Button>
                </TooltipTrigger>
                <TooltipContent>{tempoField.editable ? 'Tap to set tempo' : tempoFieldHint}</TooltipContent>
            </Tooltip>
            {time.editingTimeSig ? (
                <Row gap={0.5}>
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
                </Row>
            ) : (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={time.startTimeSigEdit}
                            aria-label={`Time signature: ${time.transport.timeSignatureNumerator}/${time.transport.timeSignatureDenominator}. Click to edit.`}
                            data-testid="transport-time-signature"
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
                        <Stack gap={0.5} className="max-h-40 overflow-y-auto">
                            {time.tempoMap.changes.map((change) => (
                                <Row
                                    gap={1.5}
                                    className="rounded px-1.5 py-1 text-xs hover:bg-accent/30"
                                    key={change.id}
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
                                </Row>
                            ))}
                        </Stack>
                    )}

                    <Row gap={1} className="mt-2 border-t border-border pt-2">
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
                    </Row>
                </div>
            ) : null}
        </Row>
    );
};
