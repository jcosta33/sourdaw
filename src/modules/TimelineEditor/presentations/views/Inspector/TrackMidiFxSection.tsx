import { type ReactElement } from 'react';

import { Power, Trash2, Settings2 } from 'lucide-react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { addMidiFx, removeMidiFx, bypassMidiFx, updateMidiFxParam } from '#/modules/Arrangement/useCases';
import { cn } from '#/utils/Styles/cn';

import { type Track } from '../../../models/TrackViewTypes';
import { ChoiceCard } from '../../components/Inspector/ChoiceCard';
import { MixerStripValue } from '../../components/Mixer/MixerStripValue';

type TrackMidiFxSectionProps = {
    track: Track;
};

export const TrackMidiFxSection = ({ track }: TrackMidiFxSectionProps): ReactElement | null => {
    if (track.kind !== 'midi') {
        return null;
    }

    const midiFx = track.midiFx || [];

    const handleAddArp = () => addMidiFx(track.id, 'arp', 'Arpeggiator');
    const handleAddVelocity = () => addMidiFx(track.id, 'velocity', 'Velocity');
    const handleAddProbability = () => addMidiFx(track.id, 'probability', 'Probability');

    const handleRemove = (fxId: string) => {
        removeMidiFx(track.id, fxId);
    };

    const handleToggleBypass = (fxId: string, current: boolean) => {
        bypassMidiFx(track.id, fxId, !current);
    };

    const handleParamChange = (fxId: string, paramId: string, value: number) => {
        updateMidiFxParam(track.id, fxId, paramId, value);
    };

    return (
        <div className="overflow-visible">
            <DawHeaderBand
                compact
                className="mb-2 rounded-sm"
                title="MIDI FX"
                actions={
                    <Row align="stretch" gap={1}>
                        <Button variant="ghost" size="xs" className="h-6 px-1.5 text-[9px]" onClick={handleAddArp}>
                            + ARP
                        </Button>
                        <Button variant="ghost" size="xs" className="h-6 px-1.5 text-[9px]" onClick={handleAddVelocity}>
                            + VEL
                        </Button>
                        <Button
                            variant="ghost"
                            size="xs"
                            className="h-6 px-1.5 text-[9px]"
                            onClick={handleAddProbability}
                        >
                            + PROB
                        </Button>
                    </Row>
                }
            />
            <Stack gap={2}>
                {midiFx.map((fx) => (
                    <ChoiceCard key={fx.id} className={cn('flex flex-col gap-2 p-2', fx.bypassed ? 'opacity-50' : '')}>
                        <Row justify="between" className="w-full">
                            <Row gap={1.5}>
                                <Settings2 className="size-3 text-accent-primary" />
                                <span className="text-xs font-semibold">{fx.name}</span>
                            </Row>
                            <Row gap={0.5}>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-6 w-6"
                                    onClick={() => handleToggleBypass(fx.id, fx.bypassed)}
                                >
                                    <Power className={cn('size-3', !fx.bypassed && 'text-state-success')} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    className="h-6 w-6"
                                    onClick={() => handleRemove(fx.id)}
                                >
                                    <Trash2 className="size-3 text-muted-foreground" />
                                </Button>
                            </Row>
                        </Row>

                        {/* Parameter Controls */}
                        <Row align="stretch" wrap gap={4} className="px-1 py-1">
                            {fx.type === 'arp' ? (
                                <>
                                    <Stack align="center" gap={1}>
                                        <RotaryKnob
                                            size="sm"
                                            value={fx.parameterValues.rate || 0.25}
                                            min={0.125}
                                            max={1.0}
                                            onChange={(value) => handleParamChange(fx.id, 'rate', value)}
                                        />
                                        <MixerStripValue size="sm">Rate</MixerStripValue>
                                    </Stack>
                                    <Stack align="center" gap={1}>
                                        <select
                                            className="bg-surface-base text-[10px] rounded border border-border/50 px-1 outline-none"
                                            value={fx.parameterValues.mode || 0}
                                            onChange={(event) =>
                                                handleParamChange(fx.id, 'mode', parseInt(event.target.value))
                                            }
                                        >
                                            <option value={0}>Up</option>
                                            <option value={1}>Down</option>
                                            <option value={2}>UpDown</option>
                                            <option value={3}>Random</option>
                                        </select>
                                        <MixerStripValue size="sm">Mode</MixerStripValue>
                                    </Stack>
                                </>
                            ) : null}
                            {fx.type === 'velocity' ? (
                                <>
                                    <Stack align="center" gap={1}>
                                        <RotaryKnob
                                            size="sm"
                                            value={fx.parameterValues.scale || 1.0}
                                            min={0.1}
                                            max={2.0}
                                            onChange={(value) => handleParamChange(fx.id, 'scale', value)}
                                        />
                                        <MixerStripValue size="sm">Scale</MixerStripValue>
                                    </Stack>
                                    <Stack align="center" gap={1}>
                                        <RotaryKnob
                                            size="sm"
                                            value={fx.parameterValues.offset || 0}
                                            min={-64}
                                            max={64}
                                            onChange={(value) => handleParamChange(fx.id, 'offset', value)}
                                        />
                                        <MixerStripValue size="sm">Offset</MixerStripValue>
                                    </Stack>
                                </>
                            ) : null}
                            {fx.type === 'probability' ? (
                                <Stack align="center" gap={1}>
                                    <RotaryKnob
                                        size="sm"
                                        value={fx.parameterValues.seed || 12345}
                                        min={1}
                                        max={65535}
                                        onChange={(value) => handleParamChange(fx.id, 'seed', value)}
                                    />
                                    <MixerStripValue size="sm">Seed</MixerStripValue>
                                </Stack>
                            ) : null}
                        </Row>
                    </ChoiceCard>
                ))}
            </Stack>
        </div>
    );
};
