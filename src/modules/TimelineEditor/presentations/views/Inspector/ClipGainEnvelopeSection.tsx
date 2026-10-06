import { type ReactElement } from 'react';

import { Activity, Plus, RotateCcw } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { defaultGainEnvelopeStoreState, gainEnvelopeStore } from '#/modules/Arrangement/stores';
import { getClipGainEnvelope } from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { InsetPanel } from '../../components/Inspector/InsetPanel';
import { MetaText } from '../../components/Inspector/MetaText';

type ClipGainEnvelopeSectionProps = {
    clipId: string;
    duration: number;
};

// The envelope edits dispatch through the command path (#4617); the guarded
// inverses live beside their siblings in Arrangement's handlers.
function dispatchToggle(clipId: string, enabled: boolean): void {
    void executeUserAppAction({ type: 'toggleClipGainEnvelope', payload: { clipId, expectedEnabled: enabled } });
}

function dispatchAddPoint(clipId: string, beatOffset: number): void {
    void executeUserAppAction({ type: 'addGainEnvelopePoint', payload: { clipId, beatOffset, gainDb: 0 } });
}

function dispatchRemovePoint(clipId: string, pointId: string): void {
    void executeUserAppAction({ type: 'removeGainEnvelopePoint', payload: { clipId, pointId } });
}

function dispatchReset(clipId: string): void {
    void executeUserAppAction({ type: 'resetClipGainEnvelope', payload: { clipId } });
}

export const ClipGainEnvelopeSection = ({ clipId, duration }: ClipGainEnvelopeSectionProps): ReactElement => {
    // §197.1 — subscribe to the canonical store so undo/redo, collab
    // sync, and external mutations trigger re-renders. The \`envKey\`
    // counter hack has been removed.
    useStore(gainEnvelopeStore, defaultGainEnvelopeStoreState);

    const envelope = getClipGainEnvelope(clipId);

    return (
        <section>
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="Gain Envelope"
                startSlot={<Activity className="size-3 text-muted-foreground" aria-hidden="true" />}
            />
            <Stack gap={2}>
                <Row justify="between">
                    <MetaText>
                        {envelope.enabled ? 'Enabled' : 'Disabled'} · {envelope.points.length} point
                        {envelope.points.length !== 1 ? 's' : ''}
                    </MetaText>
                    <Row gap={1}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => dispatchToggle(clipId, envelope.enabled)}
                                    aria-label={envelope.enabled ? 'Disable gain envelope' : 'Enable gain envelope'}
                                >
                                    <Activity
                                        className={`size-3 ${envelope.enabled ? 'text-[var(--color-state-success)]' : 'text-muted-foreground'}`}
                                    />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                                {envelope.enabled ? 'Disable gain envelope' : 'Enable gain envelope'}
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => dispatchAddPoint(clipId, duration / 2)}
                                    aria-label="Add breakpoint"
                                >
                                    <Plus className="size-3" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">Add breakpoint at midpoint</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => dispatchReset(clipId)}
                                    aria-label="Reset gain envelope"
                                >
                                    <RotateCcw className="size-3" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top">Reset to flat 0 dB</TooltipContent>
                        </Tooltip>
                    </Row>
                </Row>
                {envelope.enabled && envelope.points.length > 0 ? (
                    <InsetPanel className="space-y-1">
                        {envelope.points.map((pt) => (
                            <Row justify="between" gap={2} key={pt.id}>
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
                                    onClick={() => dispatchRemovePoint(clipId, pt.id)}
                                    aria-label={`Remove breakpoint at beat ${pt.beatOffset}`}
                                >
                                    <span className="text-[9px] text-muted-foreground">×</span>
                                </Button>
                            </Row>
                        ))}
                    </InsetPanel>
                ) : null}
            </Stack>
        </section>
    );
};
