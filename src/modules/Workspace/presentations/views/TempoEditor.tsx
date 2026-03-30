import { type ReactElement } from 'react';
import { Input } from '#/components/ui/input';
import { Button } from '#/components/ui/button';
import { ValueField } from '#/components/daw/ValueField';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { cn } from '#/helpers/Styles/cn';
import { Map, Plus, Trash2 } from 'lucide-react';
import { useTempoEditorState } from '../hooks/useTempoEditorState';

export const TempoEditor = (): ReactElement => {
    const t = useTempoEditorState();

    return (
        <div
            className="relative flex items-center gap-2 px-2 rounded-sm h-8"
            style={{
                background: 'linear-gradient(180deg, #080808 0%, #0e0e0e 100%)',
                boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.7), inset 0 0 1px rgba(0,0,0,0.3), 0 1px 0 rgba(255,255,255,0.04)',
                border: '1px solid rgba(0,0,0,0.5)',
                borderTop: '1px solid rgba(0,0,0,0.6)',
                borderBottom: '1px solid rgba(40,40,40,0.3)',
            }}
        >
            <Tooltip>
                <TooltipTrigger asChild>
                    <div>
                        <ValueField
                            value={t.transport.tempo}
                            onChange={t.setTempoValue}
                            onReset={() => t.setTempoValue(120)}
                            min={20}
                            max={300}
                            step={1}
                            fineStep={0.01}
                            unit=" BPM"
                            className="w-16"
                        />
                    </div>
                </TooltipTrigger>
                <TooltipContent>Drag up/down to adjust, double-click to reset, Shift for fine.</TooltipContent>
            </Tooltip>

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => t.setMapOpen(!t.mapOpen)}
                        aria-label="Toggle tempo map"
                        aria-expanded={t.mapOpen}
                        className={cn('size-5', t.mapOpen && 'bg-accent')}
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
                        onClick={t.handleTapTempo}
                        aria-label="Tap tempo"
                        className="text-[9px] font-bold w-6 h-5"
                    >
                        TAP
                    </Button>
                </TooltipTrigger>
                <TooltipContent>Tap to set tempo</TooltipContent>
            </Tooltip>

            {t.editingTimeSig ? (
                <div className="flex items-center gap-0.5">
                    <Input
                        type="number"
                        value={t.numValue}
                        onChange={(e) => t.setNumValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                t.commitTimeSig();
                            }
                            if (e.key === 'Escape') {
                                t.cancelTimeSigEdit();
                            }
                        }}
                        className="h-6 w-8 text-center font-mono text-xs"
                        min={1}
                        max={32}
                        autoFocus
                        aria-label="Time signature numerator"
                    />
                    <span className="text-xs text-muted-foreground">/</span>
                    <select
                        value={t.denValue}
                        onChange={(e) => t.setDenValue(e.target.value)}
                        onBlur={t.commitTimeSig}
                        className="h-6 w-10 rounded bg-surface-overlay text-center font-mono text-xs text-foreground outline-none"
                        aria-label="Time signature denominator"
                    >
                        <option value="2">2</option>
                        <option value="4">4</option>
                        <option value="8">8</option>
                        <option value="16">16</option>
                    </select>
                </div>
            ) : (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={t.startTimeSigEdit}
                            aria-label={`Time signature: ${t.transport.timeSignatureNumerator}/${t.transport.timeSignatureDenominator}. Click to edit.`}
                            className="px-2 py-0.5"
                        >
                            <span className="text-lg font-mono font-medium text-muted-foreground">
                                {t.transport.timeSignatureNumerator}/{t.transport.timeSignatureDenominator}
                            </span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>Click to edit time signature</TooltipContent>
                </Tooltip>
            )}

            {t.mapOpen ? (
                <div
                    ref={t.mapPanelRef}
                    role="dialog"
                    aria-label="Tempo map editor"
                    className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border border-border bg-popover p-2 shadow-lg"
                >
                    <h3 className="mb-1.5 text-xs font-semibold text-foreground">Tempo Map</h3>

                    {t.tempoMap.changes.length === 0 ? (
                        <p className="py-2 text-center text-xs text-muted-foreground">No tempo changes</p>
                    ) : (
                        <div className="max-h-40 space-y-0.5 overflow-y-auto">
                            {t.tempoMap.changes.map((change) => (
                                <div
                                    key={change.id}
                                    className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent/30"
                                >
                                    <span className="w-12 shrink-0 font-mono tabular-nums text-muted-foreground">
                                        Beat {change.beat}
                                    </span>

                                    {t.editingChangeId === change.id ? (
                                        <Input
                                            type="number"
                                            value={t.editingChangeTempo}
                                            onChange={(e) => t.setEditingChangeTempo(e.target.value)}
                                            onBlur={t.commitEditChange}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    t.commitEditChange();
                                                }
                                                if (e.key === 'Escape') {
                                                    t.cancelEditChange();
                                                }
                                            }}
                                            className="h-5 w-14 text-center font-mono text-xs"
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
                                            onClick={() => t.startEditChange(change)}
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
                                        onClick={() => t.removeChange(change.id)}
                                        aria-label={`Remove tempo change at beat ${change.beat}`}
                                    >
                                        <Trash2 className="size-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
                        <Input
                            type="number"
                            value={t.newBeat}
                            onChange={(e) => t.setNewBeat(e.target.value)}
                            className="h-6 w-14 text-center font-mono text-xs"
                            min={0}
                            step={1}
                            placeholder="Beat"
                            aria-label="New tempo change beat"
                        />
                        <Input
                            type="number"
                            value={t.newTempo}
                            onChange={(e) => t.setNewTempo(e.target.value)}
                            className="h-6 w-14 text-center font-mono text-xs"
                            min={20}
                            max={999}
                            step={0.1}
                            placeholder="BPM"
                            aria-label="New tempo change BPM"
                        />
                        <select
                            value={t.newCurve}
                            onChange={(e) => t.setNewCurve(e.target.value as 'instant' | 'linear')}
                            className="h-6 rounded bg-muted px-1 text-xs text-foreground outline-none"
                            aria-label="New tempo change curve type"
                        >
                            <option value="instant">instant</option>
                            <option value="linear">linear</option>
                        </select>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={t.handleAddTempoChange}
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
