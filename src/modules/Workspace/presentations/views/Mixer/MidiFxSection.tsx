import { type ReactElement, useState } from 'react';
import { cn } from '#/utils/Styles/cn';
import { addMidiFx } from '#/modules/Arrangement';
import { type Track } from '../../../models/TrackViewTypes';
import { MixerInsetButton } from '../../components/Mixer/MixerInsetButton';
import { MixerSection } from '../../components/Mixer/MixerSection';

type MidiFxSectionProps = {
    track: Track;
};

const MIDI_FX_TYPES = [
    { label: 'Arpeggiator', type: 'arp' as const },
    { label: 'Velocity', type: 'velocity' as const },
    { label: 'Probability', type: 'probability' as const },
];

export const MidiFxSection = ({ track }: MidiFxSectionProps): ReactElement | null => {
    const [showAdd, setShowAdd] = useState(false);

    if (track.kind !== 'midi') return null;

    return (
        <MixerSection label="MIDI FX">
            <div className="max-h-[80px] space-y-0.5 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/10">
                {(track as any).midiFx?.map((fx: any) => (
                    <div key={fx.id} className="group relative">
                        <MixerInsetButton
                            className={cn(
                                'shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]',
                                fx.bypassed && 'opacity-40 line-through'
                            )}
                            tone="accent"
                        >
                            <span className="text-[10px] text-accent-primary/80">
                                ♪ {fx.name}
                            </span>
                        </MixerInsetButton>
                    </div>
                ))}
            </div>
            
            {showAdd ? (
                <div className="space-y-0.5 mt-0.5">
                    {MIDI_FX_TYPES.map((fx) => (
                        <MixerInsetButton
                            key={fx.type}
                            onClick={(e) => {
                                e.stopPropagation();
                                addMidiFx(track.id, fx.type, fx.label);
                                setShowAdd(false);
                            }}
                        >
                            + {fx.label}
                        </MixerInsetButton>
                    ))}
                    <button
                        type="button"
                        className="w-full text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowAdd(false);
                        }}
                    >
                        cancel
                    </button>
                </div>
            ) : (
                <MixerInsetButton
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowAdd(true);
                    }}
                >
                    <span className="text-[10px] text-muted-foreground/50">+ add fx</span>
                </MixerInsetButton>
            )}
        </MixerSection>
    );
};
