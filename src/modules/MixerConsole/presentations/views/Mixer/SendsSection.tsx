import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { LatchButton } from '#/components/daw/LatchButton';
import { Row } from '#/components/layout';
import { Slider } from '#/components/ui/slider';
import {
    commitSendEdit,
    compileSendLevelAction,
    compileSendPreFaderAction,
    listSendDestinations,
} from '#/modules/Arrangement/useCases';
import { setSend as previewSend } from '#/modules/Routing/useCases';
import { levelToSendPosition, sendPositionToLevel } from '#/utils/audioLevelLaw';

import { type Track } from '../../../models/TrackViewTypes';
import { MixerSection } from '../../components/Mixer/MixerSection';
import { useTracks } from '../../hooks/useTracks';

type SendsSectionProps = {
    track: Track;
};

type SendState = Track['sends'][number];

/**
 * One send-level gesture: previews on the engine while it moves and commits one
 * action when it ends. A pointer drag the browser abandons (pointercancel, lost
 * capture) or a row unmounted mid-drag never reaches the slider's own commit,
 * so it is settled at the level it was left, as a released fader is. Only a
 * pointer drag can be abandoned: a keyboard step or a typed value commits in
 * the same event as its change (Radix commits a key step before reporting it).
 */
const useSendLevelGesture = (trackId: string, busId: string, send: SendState | undefined) => {
    const [localLevel, setLocalLevel] = useState<number | null>(null);
    const pointerDragRef = useRef(false);
    const uncommittedLevelRef = useRef<number | null>(null);

    const commit = (committed: number): void => {
        pointerDragRef.current = false;
        uncommittedLevelRef.current = null;
        setLocalLevel(committed);
        void commitSendEdit(compileSendLevelAction(trackId, busId, committed, send)).then(() => setLocalLevel(null));
    };
    const beginPointerDrag = (): void => {
        pointerDragRef.current = true;
    };
    const settleAbandoned = (): void => {
        const abandonedLevel = uncommittedLevelRef.current;
        pointerDragRef.current = false;
        uncommittedLevelRef.current = null;
        if (abandonedLevel !== null) {
            commit(abandonedLevel);
        }
    };
    const settleOnUnmountRef = useRef(settleAbandoned);
    useLayoutEffect(() => {
        settleOnUnmountRef.current = settleAbandoned;
    });
    useEffect(() => () => settleOnUnmountRef.current(), []);

    const preview = (next: number): void => {
        if (pointerDragRef.current) {
            uncommittedLevelRef.current = next;
        }
        setLocalLevel(next);
        previewSend(trackId, busId, next, send?.preFader ?? false);
    };
    return { level: localLevel ?? send?.level ?? 0, preview, commit, beginPointerDrag, settleAbandoned };
};

type SendRowProps = {
    track: Track;
    bus: Track;
    send: SendState | undefined;
};

const SendRow = ({ track, bus, send }: SendRowProps): ReactElement => {
    const gesture = useSendLevelGesture(track.id, bus.id, send);
    const isPreFader = send?.preFader ?? false;

    return (
        <Row gap={0.5}>
            <span className="text-[6px] text-muted-foreground truncate w-6">{bus.name}</span>
            <Slider
                value={[Math.round(levelToSendPosition(gesture.level))]}
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
                onPointerDown={gesture.beginPointerDrag}
                onPointerCancel={gesture.settleAbandoned}
                onLostPointerCapture={gesture.settleAbandoned}
                max={100}
                step={1}
                className="flex-1"
                aria-label={`Send to ${bus.name}`}
            />
            <LatchButton
                active={isPreFader}
                variant="amber"
                size="icon-sm"
                className="shrink-0 text-[5px] font-bold leading-tight px-0.5"
                onClick={(event) => {
                    event.stopPropagation();
                    if (send) {
                        void commitSendEdit(compileSendPreFaderAction(track.id, bus.id, send));
                    }
                }}
                aria-label={`Toggle send to ${bus.name} ${isPreFader ? 'post' : 'pre'}-fader`}
                title={isPreFader ? 'Pre-fader (click for post)' : 'Post-fader (click for pre)'}
            >
                {isPreFader ? 'PRE' : 'POST'}
            </LatchButton>
        </Row>
    );
};

export const SendsSection = ({ track }: SendsSectionProps): ReactElement | null => {
    const { tracks } = useTracks();
    const buses = listSendDestinations(track.id, tracks);
    if (buses.length === 0) {
        return null;
    }

    return (
        <MixerSection label="Sends">
            {buses.map((bus) => (
                <SendRow
                    key={`${track.id}:${bus.id}`}
                    track={track}
                    bus={bus}
                    send={track.sends.find((state) => state.busId === bus.id)}
                />
            ))}
        </MixerSection>
    );
};
