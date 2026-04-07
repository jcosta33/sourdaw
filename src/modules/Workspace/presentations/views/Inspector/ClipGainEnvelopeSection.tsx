import { type ReactElement, useState } from 'react';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Button } from '#/components/ui/button';
import { Activity, Plus, RotateCcw } from 'lucide-react';
import { getClipGainEnvelope } from '#/modules/Arrangement/useCases/clipGainEnvelope/getClipGainEnvelope';
import { toggleClipGainEnvelope } from '#/modules/Arrangement/useCases/clipGainEnvelope/toggleClipGainEnvelope';
import { addGainEnvelopePoint } from '#/modules/Arrangement/useCases/clipGainEnvelope/addGainEnvelopePoint';
import { removeGainEnvelopePoint } from '#/modules/Arrangement/useCases/clipGainEnvelope/removeGainEnvelopePoint';
import { resetClipGainEnvelope } from '#/modules/Arrangement/useCases/clipGainEnvelope/resetClipGainEnvelope';
import { InsetPanel } from '../../components/Inspector/InsetPanel';
import { MetaText } from '../../components/Inspector/MetaText';

type ClipGainEnvelopeSectionProps = {
    clipId: string;
    duration: number;
};

export const ClipGainEnvelopeSection = ({ clipId, duration }: ClipGainEnvelopeSectionProps): ReactElement => {
    const [envKey, setEnvKey] = useState(0);
    envKey; // used to force re-render when envelope mutates

    const envelope = getClipGainEnvelope(clipId);

    return (
        <section>
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="Gain Envelope"
                startSlot={<Activity className="size-3 text-muted-foreground" aria-hidden="true" />}
            />
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <MetaText>
                        {envelope.enabled ? 'Enabled' : 'Disabled'} · {envelope.points.length} point
                        {envelope.points.length !== 1 ? 's' : ''}
                    </MetaText>
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
                    <InsetPanel className="space-y-1">
                        {envelope.points.map((pt) => (
                            <div key={pt.id} className="flex items-center justify-between gap-2">
                                <DawMicroBadge rounded="full" className="w-12 justify-center px-0 py-0.5 font-mono">
                                    @{pt.beatOffset.toFixed(1)}
                                </DawMicroBadge>
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
                    </InsetPanel>
                ) : null}
            </div>
        </section>
    );
};
