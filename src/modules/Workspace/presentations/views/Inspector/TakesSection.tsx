import { type ReactElement, useSyncExternalStore } from 'react';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Button } from '#/components/ui/button';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { setCompRegion } from '#/modules/Arrangement/useCases/comping/setCompRegion';
import { selectTake } from '#/modules/Arrangement/useCases/comping/selectTake';
import { flattenComp } from '#/modules/Arrangement/useCases/comping/flattenComp';
import { ChoiceCard } from '../../components/Inspector/ChoiceCard';
import { MetaText } from '../../components/Inspector/MetaText';

type TakesSectionProps = {
    trackId: string;
};

export const TakesSection = ({ trackId }: TakesSectionProps): ReactElement | null => {
    const takeLaneState = useSyncExternalStore(
        (cb) => takeLaneStore.subscribe(cb),
        () => takeLaneStore.value
    );

    const lane = takeLaneState?.lanes.find((l) => l.trackId === trackId);
    if (!lane || lane.takes.length === 0) {
        return null;
    }

    const handleSetActive = (takeId: string) => {
        const take = lane.takes.find((t) => t.id === takeId);
        if (!take) {
            return;
        }
        selectTake(trackId, takeId);
        setCompRegion(trackId, {
            takeId,
            startBeat: take.startBeat,
            endBeat: take.endBeat,
        });
    };

    return (
        <div className="pt-2">
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title={`Takes (${lane.takes.length})`}
                actions={
                    <Button variant="ghost" size="xs" onClick={() => flattenComp(trackId)} aria-label="Flatten comp">
                        Flatten
                    </Button>
                }
            />
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                {lane.takes.map((take) => (
                    <ChoiceCard
                        key={take.id}
                        className="flex flex-col justify-center gap-2"
                        selected={take.selected}
                        interactive={false}
                    >
                        <div className="flex items-center justify-between w-full">
                            <div className="min-w-0 flex-1">
                                <span className="text-xs text-foreground font-medium truncate block">{take.name}</span>
                                <MetaText>
                                    beat {take.startBeat}–{take.endBeat}
                                </MetaText>
                            </div>
                            {take.selected ? (
                                <DawMicroBadge tone="primary" className="ml-2 shrink-0">
                                    Active
                                </DawMicroBadge>
                            ) : null}
                        </div>
                        {!take.selected ? (
                            <Button
                                variant="secondary"
                                size="xs"
                                className="w-full"
                                onClick={() => handleSetActive(take.id)}
                                aria-label={`Set ${take.name} as active take`}
                            >
                                Set Active
                            </Button>
                        ) : null}
                    </ChoiceCard>
                ))}
            </div>
        </div>
    );
};
