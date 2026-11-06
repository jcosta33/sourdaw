import { type ReactElement, useRef, useState } from 'react';

import { LatchButton } from '#/components/daw/LatchButton';
import { Row } from '#/components/layout';
import { Slider } from '#/components/ui/slider';
import {
    commitSendEdit,
    commitSendLevel,
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
 * action when it ends. The Slider ends every gesture in one commit, including
 * one the browser abandons or a row unmounted mid-drag; this hook orders those
 * commits, so a step taken before the previous one lands is guarded on the
 * level that one wrote, and the row shows the latest committed level until it
 * lands.
 */
const useSendLevelGesture = (trackId: string, busId: string, send: SendState | undefined) => {
    const [localLevel, setLocalLevel] = useState<number | null>(null);
    const latestCommitRef = useRef<Promise<void> | null>(null);

    // The slider keeps showing the committed level until the last commit
    // settles: an earlier one settling must not drop a later step's level.
    const commit = (committed: number): void => {
        setLocalLevel(committed);
        const pending = commitSendLevel(trackId, busId, committed);
        latestCommitRef.current = pending;
        void pending.then(() => {
            if (latestCommitRef.current === pending) {
                setLocalLevel(null);
            }
        });
    };

    const preview = (next: number): void => {
        setLocalLevel(next);
        previewSend(trackId, busId, next, send?.preFader ?? false);
    };
    return { level: localLevel ?? send?.level ?? 0, preview, commit };
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
