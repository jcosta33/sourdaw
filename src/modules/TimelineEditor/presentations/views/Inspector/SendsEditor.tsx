import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Plus } from 'lucide-react';

import { DawEmptyState } from '#/components/daw/DawEmptyState';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Slider } from '#/components/ui/slider';
import {
    commitSendEdit,
    compileSendLevelAction,
    compileSendPreFaderAction,
    listSendDestinations,
} from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { setSend as previewSend } from '#/modules/Routing/useCases';
import { gainToDb, levelToSendPosition, sendPositionToLevel } from '#/utils/audioLevelLaw';
import { cn } from '#/utils/Styles/cn';

import { type Track } from '../../../models/TrackViewTypes';
import { ControlHeader } from '../../components/Inspector/ControlHeader';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';
import { useTracks } from '../../hooks/useTracks';

type SendsEditorProps = {
    track: Track;
};

/**
 * Sends read out in decibels, matching the control law (FX-7). A percentage of
 * a linear amplitude is not a level a mixing engineer can act on: "50%" is
 * -6 dB, not half as loud.
 */
function formatSendLevel(level: number): string {
    if (level <= 0) {
        return '-∞ dB';
    }
    return `${gainToDb(level).toFixed(1)} dB`;
}

type SendState = Track['sends'][number];

type SendCardProps = {
    track: Track;
    bus: Track;
    send: SendState | undefined;
};

/**
 * One send-level gesture: previews on the engine while it moves and commits one
 * action when it ends. A drag the pointer abandons (pointercancel, lost capture)
 * or a card unmounted mid-drag never reaches the slider's own commit, so it is
 * settled at the level it was left, as a released fader is.
 */
const useSendLevelGesture = (trackId: string, busId: string, send: SendState | undefined) => {
    const [localLevel, setLocalLevel] = useState<number | null>(null);
    const uncommittedLevelRef = useRef<number | null>(null);

    // Every slider commit follows a change, so a gesture with nothing
    // uncommitted was already settled and must not dispatch a second action.
    const commit = (committed: number): void => {
        if (uncommittedLevelRef.current === null) {
            return;
        }
        uncommittedLevelRef.current = null;
        setLocalLevel(committed);
        void commitSendEdit(compileSendLevelAction(trackId, busId, committed, send)).then(() => setLocalLevel(null));
    };
    const settleAbandoned = (): void => {
        if (uncommittedLevelRef.current !== null) {
            commit(uncommittedLevelRef.current);
        }
    };
    const settleOnUnmountRef = useRef(settleAbandoned);
    useLayoutEffect(() => {
        settleOnUnmountRef.current = settleAbandoned;
    });
    useEffect(() => () => settleOnUnmountRef.current(), []);

    const preview = (next: number): void => {
        uncommittedLevelRef.current = next;
        setLocalLevel(next);
        previewSend(trackId, busId, next, send?.preFader ?? false);
    };
    return { level: localLevel ?? send?.level ?? 0, preview, commit, settleAbandoned };
};

const SendCard = ({ track, bus, send }: SendCardProps): ReactElement => {
    const gesture = useSendLevelGesture(track.id, bus.id, send);
    const level = gesture.level;
    const isPreFader = send?.preFader ?? false;

    const togglePreFader = (): void => {
        if (!send) {
            return;
        }
        void commitSendEdit(compileSendPreFaderAction(track.id, bus.id, send));
    };

    return (
        <SurfaceCard className="w-full p-3">
            <Stack gap={2} className="w-full">
                <ControlHeader
                    className="w-full"
                    label={bus.name}
                    labelClassName="max-w-[50%] truncate font-medium text-foreground"
                    value={
                        <Row gap={1.5}>
                            <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
                                {formatSendLevel(level)}
                            </span>
                            <Button
                                variant="bare"
                                size="bare"
                                type="button"
                                className="shrink-0"
                                onClick={togglePreFader}
                                aria-label={`Toggle send to ${bus.name} ${isPreFader ? 'post' : 'pre'}-fader`}
                                title={isPreFader ? 'Pre-fader (click for post)' : 'Post-fader (click for pre)'}
                            >
                                <DawMicroBadge
                                    tone={isPreFader ? 'peach' : 'muted'}
                                    className={cn('transition-colors', !isPreFader && 'hover:text-foreground')}
                                >
                                    {isPreFader ? 'PRE' : 'POST'}
                                </DawMicroBadge>
                            </Button>
                        </Row>
                    }
                    valueClassName="font-normal"
                    title={bus.name}
                />
                <Row justify="center" className="w-full px-1">
                    <Slider
                        value={[Math.round(levelToSendPosition(level))]}
                        onValueChange={([value]) => {
                            if (value === undefined) {
                                return;
                            }
                            gesture.preview(sendPositionToLevel(value));
                        }}
                        onValueCommit={([value]) => {
                            if (value === undefined) {
                                return;
                            }
                            gesture.commit(sendPositionToLevel(value));
                        }}
                        onPointerCancel={gesture.settleAbandoned}
                        onLostPointerCapture={gesture.settleAbandoned}
                        max={100}
                        step={1}
                        aria-label={`Send to ${bus.name}`}
                        className="w-full"
                    />
                </Row>
            </Stack>
        </SurfaceCard>
    );
};

export const SendsEditor = ({ track }: SendsEditorProps): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const buses = listSendDestinations(track.id, allTracks);

    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="Sends" />
            {buses.length > 0 ? (
                <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                    {buses.map((bus) => (
                        <SendCard
                            key={`${track.id}:${bus.id}`}
                            track={track}
                            bus={bus}
                            send={track.sends.find((state) => state.busId === bus.id)}
                        />
                    ))}
                </div>
            ) : (
                <DawEmptyState
                    compact
                    className="mx-1"
                    title="No bus tracks yet"
                    description="Create a bus to start sharing signal between tracks."
                    action={
                        <Button
                            variant="outline"
                            size="xs"
                            onClick={() => {
                                // The registered bus-creation action, not the
                                // bare addTrack use case, so the bus enters
                                // undo history (#4618) — the same gesture the
                                // empty-timeline menu's Add Bus Track takes.
                                void executeUserAppAction({
                                    type: 'createBus',
                                    payload: { name: `Bus ${buses.length + 1}` },
                                });
                            }}
                        >
                            <Plus className="size-3 mr-1" />
                            Create Bus
                        </Button>
                    }
                />
            )}
        </div>
    );
};
