import { type ReactElement } from 'react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawMicroBadge } from '#/components/daw/DawMicroBadge';
import { Row } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { takeLaneStore } from '#/modules/Arrangement/stores';
import { setCompRegion, selectTake, flattenComp } from '#/modules/Arrangement/useCases';

import { ChoiceCard } from '../../components/Inspector/ChoiceCard';
import { MetaText } from '../../components/Inspector/MetaText';

type TakesSectionProps = {
    trackId: string;
};

type TakeLaneView = {
    trackId: string;
    takes: Array<{
        id: string;
        name: string;
        startBeat: number;
        endBeat: number;
        selected: boolean;
    }>;
};

type TakeLaneViewState = {
    lanes: TakeLaneView[];
};

export const TakesSection = ({ trackId }: TakesSectionProps): ReactElement | null => {
    const takeLaneState = useStore<TakeLaneViewState>(takeLaneStore, { lanes: [] });

    const lane = takeLaneState.lanes.find((length) => length.trackId === trackId);
    if (!lane || lane.takes.length === 0) {
        return null;
    }

    const handleSetActive = (takeId: string) => {
        const take = lane.takes.find((time) => time.id === takeId);
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
                        <Row justify="between" className="w-full">
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
                        </Row>
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
