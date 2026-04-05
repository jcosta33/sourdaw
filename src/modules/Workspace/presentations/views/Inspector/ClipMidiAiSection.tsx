import { type ReactElement, useState } from 'react';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Button } from '#/components/ui/button';
import { Sparkles, Loader2, Music } from 'lucide-react';
import { generateMidiVariations } from '#/modules/AiGeneration/useCases/generateMidiVariations';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { notifyAiChange } from '#/modules/AiRuntime/useCases/notifyAiChange';

type ClipMidiAiSectionProps = {
    clipId: string;
};

export const ClipMidiAiSection = ({ clipId }: ClipMidiAiSectionProps): ReactElement => {
    const [isGeneratingVariations, setIsGeneratingVariations] = useState(false);

    const handleGenerateVariations = async (): Promise<void> => {
        setIsGeneratingVariations(true);
        try {
            await generateMidiVariations(clipId);
            notifyAiChange('MIDI variations generated', ['3 unique musical variations created as alternative clips']);
        } catch (err) {
            notifyUser(err instanceof Error ? err.message : 'Variation generation failed', 'error');
        } finally {
            setIsGeneratingVariations(false);
        }
    };

    return (
        <section>
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="AI Actions"
                startSlot={<Sparkles className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />}
            />
            <div className="space-y-3">
                <div className="bg-surface-raised/50 rounded-md p-2 space-y-1.5 border border-border/30">
                    <div className="flex items-center gap-1.5">
                        <Music className="size-3 text-[var(--color-accent-lavender)]" aria-hidden="true" />
                        <span className="text-[10px] font-medium text-foreground/90">AI Variations</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground leading-relaxed">
                        Generate 3 musical variations (rhythm, passing notes, simplification).
                    </p>
                    <Button
                        variant="secondary"
                        size="xs"
                        className="w-full h-6 text-[10px] bg-[var(--color-accent-lavender)]/20 hover:bg-[var(--color-accent-lavender)]/40 text-[var(--color-accent-lavender)]"
                        onClick={handleGenerateVariations}
                        disabled={isGeneratingVariations}
                    >
                        {isGeneratingVariations ? (
                            <>
                                <Loader2 className="size-3 mr-1 animate-spin" /> Generating…
                            </>
                        ) : (
                            <>
                                <Sparkles className="size-3 mr-1" /> Generate
                            </>
                        )}
                    </Button>
                </div>
            </div>
        </section>
    );
};
