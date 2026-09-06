import { type ReactElement, useEffect, useState } from 'react';

import { Radio, Scissors, SlidersHorizontal } from 'lucide-react';

import { DawTransportCluster } from '#/components/daw/DawTransportCluster';
import { LatchButton } from '#/components/daw/LatchButton';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { transportStore } from '#/modules/Transport/stores';
import { defaultTransportState, setPunchIn, setPunchOut } from '#/modules/Transport/useCases';
import { cn } from '#/utils/Styles/cn';

import { punchRecordingStore, type PunchRecordingState } from '../../stores/punchRecordingStore';
import { definePunchRegion } from '../../useCases/punchRecording/definePunchRegion';
import { setPostRoll } from '../../useCases/punchRecording/setPostRoll';
import { setPreRoll } from '../../useCases/punchRecording/setPreRoll';
import { togglePunchRecording } from '../../useCases/punchRecording/togglePunchRecording';

const emptyPunchState: PunchRecordingState = {
    captures: [],
    defaultPreRoll: 4,
    defaultPostRoll: 2,
    defaultCrossfade: 0.25,
    enabled: false,
};

type NumberFieldProps = {
    label: string;
    value: number;
    min?: number;
    step?: number;
    onCommit: (value: number) => void;
    tooltip: string;
    ariaLabel: string;
    testId?: string;
};

const NumberField = ({
    label,
    value,
    min = 0,
    step = 1,
    onCommit,
    tooltip,
    ariaLabel,
    testId,
}: NumberFieldProps): ReactElement => {
    const [draft, setDraft] = useState<string>(String(value));

    useEffect(() => {
        setDraft(String(value));
    }, [value]);

    const commit = (): void => {
        const parsed = Number.parseFloat(draft);
        const next = Number.isFinite(parsed) ? Math.max(min, parsed) : min;
        onCommit(next);
        setDraft(String(next));
    };

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Row as="label" gap={1} className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    <span>{label}</span>
                    <Input
                        type="number"
                        min={min}
                        step={step}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commit}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                commit();
                            }
                        }}
                        className="h-6 w-12 px-1 text-[10px]"
                        aria-label={ariaLabel}
                        data-testid={testId}
                    />
                </Row>
            </TooltipTrigger>
            <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
    );
};

type PunchRecordingControlsProps = {
    compact?: boolean;
};

export const PunchRecordingControls = ({ compact = false }: PunchRecordingControlsProps): ReactElement => {
    const punch = useStore(punchRecordingStore, emptyPunchState);
    const transport = useStore(transportStore, defaultTransportState);

    const activeCapture = punch.captures.find((capture) => capture.recording);

    const onDefineRegion = (): void => {
        if (!activeCapture) {
            return;
        }
        definePunchRegion(activeCapture.id, transport.punchInBeat, transport.punchOutBeat);
    };

    const punchFields = (
        <>
            <NumberField
                label="In"
                value={transport.punchInBeat}
                step={0.25}
                onCommit={setPunchIn}
                tooltip="Punch-in beat"
                ariaLabel="Punch-in beat"
                testId="punch-in-beat"
            />
            <NumberField
                label="Out"
                value={transport.punchOutBeat}
                step={0.25}
                onCommit={setPunchOut}
                tooltip="Punch-out beat"
                ariaLabel="Punch-out beat"
                testId="punch-out-beat"
            />
            <NumberField
                label="Pre"
                value={punch.defaultPreRoll}
                step={1}
                onCommit={setPreRoll}
                tooltip="Pre-roll beats captured before punch-in"
                ariaLabel="Pre-roll in beats"
                testId="punch-pre-roll"
            />
            <NumberField
                label="Post"
                value={punch.defaultPostRoll}
                step={1}
                onCommit={setPostRoll}
                tooltip="Post-roll beats captured after punch-out"
                ariaLabel="Post-roll in beats"
                testId="punch-post-roll"
            />
        </>
    );
    const markControl = (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="bare"
                    size="bare"
                    type="button"
                    className={cn(
                        'inline-flex h-6 items-center gap-1 rounded-sm border border-border-soft px-1.5 text-[10px] uppercase tracking-wider text-text-secondary transition-colors',
                        compact ? 'w-full justify-center' : '',
                        activeCapture
                            ? 'bg-[var(--color-state-record)]/15 text-[var(--color-state-record)] hover:bg-[var(--color-state-record)]/25'
                            : 'opacity-60'
                    )}
                    aria-label="Mark punch region from current capture"
                    disabled={!activeCapture}
                    onClick={onDefineRegion}
                >
                    <Scissors className="size-3" aria-hidden="true" />
                    <span>Mark</span>
                </Button>
            </TooltipTrigger>
            <TooltipContent>
                {activeCapture
                    ? 'Carve a punch region from the active background capture'
                    : 'Start playback with background capture enabled to mark a region'}
            </TooltipContent>
        </Tooltip>
    );

    return (
        <DawTransportCluster tone="well" role="group" aria-label="Punch recording controls">
            <Tooltip>
                <TooltipTrigger asChild>
                    <LatchButton
                        active={punch.enabled}
                        variant="red"
                        size="icon-sm"
                        aria-label={punch.enabled ? 'Disable background capture' : 'Enable background capture'}
                        aria-pressed={punch.enabled}
                        onClick={togglePunchRecording}
                    >
                        <Radio className="size-3" aria-hidden="true" />
                    </LatchButton>
                </TooltipTrigger>
                <TooltipContent>{punch.enabled ? 'Background capture on' : 'Background capture off'}</TooltipContent>
            </Tooltip>

            {compact ? (
                <Popover>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon-sm" aria-label="Punch recording settings">
                                    <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                                </Button>
                            </PopoverTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Punch recording settings</TooltipContent>
                    </Tooltip>
                    <PopoverContent align="start" aria-label="Punch recording settings">
                        <Stack gap={2}>
                            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-tertiary">
                                Punch recording
                            </p>
                            <Grid cols={2} gap={2}>
                                {punchFields}
                            </Grid>
                            {markControl}
                        </Stack>
                    </PopoverContent>
                </Popover>
            ) : (
                <>
                    {punchFields}
                    {markControl}
                </>
            )}
        </DawTransportCluster>
    );
};
