import { type ReactElement, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Activity, Plus, RotateCcw } from 'lucide-react';
import {
    getClipGainEnvelope,
    toggleClipGainEnvelope,
    addGainEnvelopePoint,
    removeGainEnvelopePoint,
    resetClipGainEnvelope,
} from '#/modules/Arrangement/useCases/clipGainEnvelope';

type ClipGainEnvelopeSectionProps = {
    clipId: string;
    duration: number;
};

export const ClipGainEnvelopeSection = ({ clipId, duration }: ClipGainEnvelopeSectionProps): ReactElement => {
    const [envKey, setEnvKey] = useState(0);
    void envKey; // used to force re-render when envelope mutates

    const envelope = getClipGainEnvelope(clipId);

    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="size-3" aria-hidden="true" />
                Gain Envelope
            </h3>
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                        {envelope.enabled ? 'Enabled' : 'Disabled'} · {envelope.points.length} point
                        {envelope.points.length !== 1 ? 's' : ''}
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                                toggleClipGainEnvelope(clipId);
                                setEnvKey((k) => k + 1);
                            }}
                            aria-label={envelope.enabled ? 'Disable gain envelope' : 'Enable gain envelope'}
                            title={envelope.enabled ? 'Disable' : 'Enable'}
                        >
                            <Activity
                                className={`size-3 ${envelope.enabled ? 'text-[var(--color-state-success)]' : 'text-muted-foreground'}`}
                            />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                                addGainEnvelopePoint(clipId, duration / 2, 0);
                                setEnvKey((k) => k + 1);
                            }}
                            aria-label="Add breakpoint"
                            title="Add breakpoint at midpoint"
                        >
                            <Plus className="size-3" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => {
                                resetClipGainEnvelope(clipId);
                                setEnvKey((k) => k + 1);
                            }}
                            aria-label="Reset gain envelope"
                            title="Reset to flat 0 dB"
                        >
                            <RotateCcw className="size-3" />
                        </Button>
                    </div>
                </div>
                {envelope.enabled && envelope.points.length > 0 ? (
                    <div className="rounded-md bg-surface-well border border-border-hairline shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] p-2 space-y-1">
                        {envelope.points.map((pt) => (
                            <div key={pt.id} className="flex items-center justify-between gap-2">
                                <span className="text-[9px] font-mono text-muted-foreground w-12 shrink-0">
                                    @{pt.beatOffset.toFixed(1)}
                                </span>
                                <span className="text-[9px] font-mono text-foreground flex-1 text-right">
                                    {pt.gainDb > 0 ? '+' : ''}
                                    {pt.gainDb.toFixed(1)} dB
                                </span>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-4 w-4"
                                    onClick={() => {
                                        removeGainEnvelopePoint(clipId, pt.id);
                                        setEnvKey((k) => k + 1);
                                    }}
                                    aria-label={`Remove breakpoint at beat ${pt.beatOffset}`}
                                >
                                    <span className="text-[9px] text-muted-foreground">×</span>
                                </Button>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </section>
    );
};
