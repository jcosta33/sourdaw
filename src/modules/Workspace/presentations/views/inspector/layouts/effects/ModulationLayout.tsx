import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { ModulationLFO } from '../../../../components/ModulationLFO';

const getLfoShape = (
    pv: Record<string, number>,
    isTremolo: boolean,
    isAutoPan: boolean
): 'sine' | 'triangle' | 'square' => {
    if (isTremolo) { return (pv['trem-shape'] ?? 0) === 1 ? 'square' : 'sine'; }
    if (isAutoPan) { return (pv['autopan-shape'] ?? 0) === 1 ? 'triangle' : 'sine'; }
    return 'sine';
};

const getLfoRate = (
    pv: Record<string, number>,
    isChorus: boolean,
    isFlanger: boolean,
    isPhaser: boolean,
    isTremolo: boolean,
    isAutoPan: boolean
): number => {
    if (isChorus) { return pv['chorus-rate'] ?? 1; }
    if (isFlanger) { return pv['flanger-rate'] ?? 0.3; }
    if (isPhaser) { return pv['phaser-rate'] ?? 0.5; }
    if (isTremolo) { return pv['trem-rate'] ?? 4; }
    if (isAutoPan) { return pv['autopan-rate'] ?? 2; }
    return 1;
};

const getLfoDepth = (
    pv: Record<string, number>,
    isChorus: boolean,
    isFlanger: boolean,
    isPhaser: boolean,
    isTremolo: boolean,
    isAutoPan: boolean
): number => {
    if (isChorus) { return pv['chorus-depth'] ?? 5; }
    if (isFlanger) { return Math.min(1, (pv['flanger-depth'] ?? 3) / 10); }
    if (isPhaser) { return pv['phaser-depth'] ?? 0.5; }
    if (isTremolo) { return pv['trem-depth'] ?? 0.5; }
    if (isAutoPan) { return pv['autopan-depth'] ?? 0.7; }
    return 0.5;
};

const ModulationLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const isChorus = device.type === 'builtin-chorus';
    const isFlanger = device.type === 'builtin-flanger';
    const isPhaser = device.type === 'builtin-phaser';
    const isTremolo = device.type === 'builtin-tremolo';
    const isAutoPan = device.type === 'builtin-autopan';

    const lfoRate = getLfoRate(pv, isChorus, isFlanger, isPhaser, isTremolo, isAutoPan);
    const lfoDepth = getLfoDepth(pv, isChorus, isFlanger, isPhaser, isTremolo, isAutoPan);
    const lfoShape = getLfoShape(pv, isTremolo, isAutoPan);

    const characterParams = parameters.filter((p) =>
        p.name.toLowerCase().includes('feedback') ||
        p.name.toLowerCase().includes('mix') ||
        p.name.toLowerCase().includes('dry') ||
        p.name.toLowerCase().includes('stages') ||
        p.name.toLowerCase().includes('voices')
    );

    return (
        <div className="space-y-3">
            <div>
                <SectionHeader title="LFO Waveform" />
                <div className="flex justify-center">
                    <ModulationLFO rate={lfoRate} depth={lfoDepth} shape={lfoShape} width={180} height={60} />
                </div>
            </div>
            <div>
                <SectionHeader title="Modulation" />
                <ParamGrid
                    params={parameters.filter((p) =>
                        p.name.toLowerCase().includes('rate') ||
                        p.name.toLowerCase().includes('depth') ||
                        p.name.toLowerCase().includes('shape')
                    )}
                    device={device}
                    trackId={trackId}
                />
            </div>
            {characterParams.length > 0 ? (
                <div>
                    <SectionHeader title="Character" />
                    <ParamGrid params={characterParams} device={device} trackId={trackId} />
                </div>
            ) : null}
        </div>
    );
};

registerDeviceLayout(
    ['builtin-chorus', 'builtin-flanger', 'builtin-phaser', 'builtin-tremolo', 'builtin-autopan'],
    ModulationLayout
);
