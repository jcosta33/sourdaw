import { type ReactElement } from 'react';

import { LatchButton } from '#/components/daw/LatchButton';
import { Row } from '#/components/layout';
import { Slider } from '#/components/ui/slider';
import { setSend, toggleSendPreFader } from '#/modules/Arrangement/useCases';
import { levelToSendPosition, sendPositionToLevel } from '#/utils/audioLevelLaw';

import { type Track } from '../../../models/TrackViewTypes';
import { MixerSection } from '../../components/Mixer/MixerSection';
import { useTracks } from '../../hooks/useTracks';

type SendsSectionProps = {
    track: Track;
};

export const SendsSection = ({ track }: SendsSectionProps): ReactElement | null => {
    const { tracks } = useTracks();
    const buses = tracks.filter((time) => time.kind === 'bus');
    if (buses.length === 0) {
        return null;
    }

    return (
        <MixerSection label="Sends">
            {buses.map((bus) => {
                const send = track.sends.find((state) => state.busId === bus.id);
                const level = send?.level ?? 0;
                const isPreFader = send?.preFader ?? false;
                return (
                    <Row key={bus.id} gap={0.5}>
                        <span className="text-[6px] text-muted-foreground truncate w-6">{bus.name}</span>
                        <Slider
                            value={[Math.round(levelToSendPosition(level))]}
                            onValueChange={([value]) => {
                                if (value !== undefined) {
                                    setSend(track.id, bus.id, sendPositionToLevel(value));
                                }
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
                                toggleSendPreFader(track.id, bus.id);
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
