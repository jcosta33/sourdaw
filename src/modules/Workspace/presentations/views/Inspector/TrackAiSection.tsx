import { type ReactElement } from 'react';

import { Drum, Music2, Music3, Sparkles, Waves } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { Button } from '#/components/ui/button';
import { runAiActionWithToast } from '#/modules/AiRuntime/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Track } from '../../../models/TrackViewTypes';

type TrackAiSectionProps = {
    track: Track;
};

export const TrackAiSection = ({ track }: TrackAiSectionProps): ReactElement | null => {
    if (track.kind !== 'midi') {
        return null;
    }

    const trackId = track.id;
    const firstMidiClipId = track.clips.find((c) => c.type === 'midi')?.id ?? null;

    const handleDrums = (style: string): void => {
        executeAppAction({ type: 'generateDrumPattern', payload: { style, trackId, bars: 4 } });
    };

    const handleMelody = (style: string): void => {
        executeAppAction({ type: 'generateMelody', payload: { style, trackId, bars: 4 } });
    };

    const handleChords = (style: string): void => {
        executeAppAction({ type: 'generateChordProgression', payload: { style, trackId, bars: 4 } });
    };

    const handleBass = (): void => {
        if (!firstMidiClipId) {
            notifyUser('Add a MIDI clip (chords or melody) to this track first — the bassline follows it', 'error');
            return;
        }
        void runAiActionWithToast(
            () =>
                executeAppAction({
                    type: 'generateBassline',
                    payload: { clipId: firstMidiClipId, style: 'root-fifth', trackId },
                }),
            {
                startMsg: 'Generating bassline…',
                successMsg: 'Bassline generated',
                successDetails: ['Created notes that follow the clip harmonically'],
                failMsg: 'Bassline generation failed',
            }
        );
    };

    return (
        <section>
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="AI Generate"
                startSlot={<Sparkles className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
            />

            <div className="space-y-2">
                <DawPluginSectionCard
                    title="Drum Pattern"
                    detail={<Drum className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
                    detailMode="badge"
                >
                    <div className="grid grid-cols-3 gap-1">
                        <Button
                            variant="secondary"
                            size="xs"
                            className="h-6 text-[10px] bg-[var(--color-accent-lavender)]/10 hover:bg-[var(--color-accent-lavender)]/25 text-[var(--color-accent-lavender)]"
                            onClick={() => handleDrums('rock')}
                        >
                            Rock
                        </Button>
                        <Button
                            variant="secondary"
                            size="xs"
                            className="h-6 text-[10px] bg-[var(--color-accent-lavender)]/10 hover:bg-[var(--color-accent-lavender)]/25 text-[var(--color-accent-lavender)]"
                            onClick={() => handleDrums('house')}
                        >
                            House
                        </Button>
                        <Button
                            variant="secondary"
                            size="xs"
                            className="h-6 text-[10px] bg-[var(--color-accent-lavender)]/10 hover:bg-[var(--color-accent-lavender)]/25 text-[var(--color-accent-lavender)]"
                            onClick={() => handleDrums('hiphop')}
                        >
                            Hip-Hop
                        </Button>
                    </div>
                </DawPluginSectionCard>

                <DawPluginSectionCard
                    title="Melody"
                    detail={<Music2 className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
                    detailMode="badge"
                >
                    <div className="grid grid-cols-2 gap-1">
                        <Button
                            variant="secondary"
                            size="xs"
                            className="h-6 text-[10px] bg-[var(--color-accent-lavender)]/10 hover:bg-[var(--color-accent-lavender)]/25 text-[var(--color-accent-lavender)]"
                            onClick={() => handleMelody('simple')}
                        >
                            Simple
                        </Button>
                        <Button
                            variant="secondary"
                            size="xs"
                            className="h-6 text-[10px] bg-[var(--color-accent-lavender)]/10 hover:bg-[var(--color-accent-lavender)]/25 text-[var(--color-accent-lavender)]"
                            onClick={() => handleMelody('jazz')}
                        >
                            Jazz
                        </Button>
                    </div>
                </DawPluginSectionCard>

                <DawPluginSectionCard
                    title="Chord Progression"
                    detail={<Music3 className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
                    detailMode="badge"
                >
                    <div className="grid grid-cols-2 gap-1">
                        <Button
                            variant="secondary"
                            size="xs"
                            className="h-6 text-[10px] bg-[var(--color-accent-lavender)]/10 hover:bg-[var(--color-accent-lavender)]/25 text-[var(--color-accent-lavender)]"
                            onClick={() => handleChords('pop')}
                        >
                            Pop
                        </Button>
                        <Button
                            variant="secondary"
                            size="xs"
                            className="h-6 text-[10px] bg-[var(--color-accent-lavender)]/10 hover:bg-[var(--color-accent-lavender)]/25 text-[var(--color-accent-lavender)]"
                            onClick={() => handleChords('jazz')}
                        >
                            Jazz
                        </Button>
                    </div>
                </DawPluginSectionCard>

                <DawPluginSectionCard
                    title="Bassline"
                    detail={<Waves className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
                    detailMode="badge"
                >
                    <Button
                        variant="secondary"
                        size="xs"
                        className="w-full h-6 text-[10px] bg-[var(--color-accent-lavender)]/10 hover:bg-[var(--color-accent-lavender)]/25 text-[var(--color-accent-lavender)]"
                        onClick={handleBass}
                        disabled={firstMidiClipId === null}
                    >
                        {firstMidiClipId ? 'Generate Bass from Clip' : 'Add a clip first'}
                    </Button>
                </DawPluginSectionCard>
            </div>
        </section>
    );
};
