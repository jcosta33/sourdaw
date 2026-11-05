import { type ReactElement, useState } from 'react';

import { LatchButton } from '#/components/daw/LatchButton';
import { Row } from '#/components/layout';
import { Slider } from '#/components/ui/slider';
import { logger } from '#/infra/logger/appLogger';
import {
    compileSendLevelAction,
    compileSendPreFaderAction,
    listSendDestinations,
    restoreSendEngineFromProjectTruth,
} from '#/modules/Arrangement/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { setSend as previewSend } from '#/modules/Routing/useCases';
import { levelToSendPosition, sendPositionToLevel } from '#/utils/audioLevelLaw';

import { type Track } from '../../../models/TrackViewTypes';
import { MixerSection } from '../../components/Mixer/MixerSection';
import { useTracks } from '../../hooks/useTracks';

type SendsSectionProps = {
    track: Track;
};

const commitSendEdit = (
    action: Parameters<typeof executeAppAction>[0],
    trackId: string,
    busId: string,
    clearGesture: () => void
): void => {
    void (async () => {
        try {
            await executeAppAction(action);
        } catch (error) {
            logger.error(new Error(`Mixer send commit failed for action: ${action.type}`, { cause: error }));
            restoreSendEngineFromProjectTruth(trackId, busId);
        } finally {
            clearGesture();
        }
    })();
};

export const SendsSection = ({ track }: SendsSectionProps): ReactElement | null => {
    const { tracks } = useTracks();
    const [localLevels, setLocalLevels] = useState<Record<string, number>>({});
    const buses = listSendDestinations(track.id, tracks);

    const clearLocalLevel = (busId: string): void => {
        setLocalLevels((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== busId)));
    };
    if (buses.length === 0) {
        return null;
    }

    return (
        <MixerSection label="Sends">
            {buses.map((bus) => {
                const send = track.sends.find((state) => state.busId === bus.id);
                const level = localLevels[bus.id] ?? send?.level ?? 0;
                const isPreFader = send?.preFader ?? false;
                return (
                    <Row key={bus.id} gap={0.5}>
                        <span className="text-[6px] text-muted-foreground truncate w-6">{bus.name}</span>
                        <Slider
                            value={[Math.round(levelToSendPosition(level))]}
                            onValueChange={([value]) => {
                                if (value === undefined) {
                                    return;
                                }
                                const next = sendPositionToLevel(value);
                                setLocalLevels((current) => ({ ...current, [bus.id]: next }));
                                previewSend(track.id, bus.id, next, send?.preFader ?? false);
                            }}
                            onValueCommit={([value]) => {
                                if (value === undefined) {
                                    return;
                                }
                                const committed = sendPositionToLevel(value);
                                setLocalLevels((current) => ({ ...current, [bus.id]: committed }));
                                commitSendEdit(
                                    compileSendLevelAction(track.id, bus.id, committed, send),
                                    track.id,
                                    bus.id,
                                    () => clearLocalLevel(bus.id)
                                );
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
                                    commitSendEdit(
                                        compileSendPreFaderAction(track.id, bus.id, send),
                                        track.id,
                                        bus.id,
                                        () => undefined
                                    );
                                }
                            }}
                            aria-label={`Toggle send to ${bus.name} ${isPreFader ? 'post' : 'pre'}-fader`}
                            title={isPreFader ? 'Pre-fader (click for post)' : 'Post-fader (click for pre)'}
                        >
                            {isPreFader ? 'PRE' : 'POST'}
                        </LatchButton>
                    </Row>
                );
            })}
        </MixerSection>
    );
};
