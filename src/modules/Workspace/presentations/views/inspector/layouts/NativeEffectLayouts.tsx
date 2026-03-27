/**
 * Layouts for native DSP effects (native-eq, native-compressor, etc.)
 * These use the GenericDeviceLayout with interactive visualizations
 * where the param names match (threshold, ratio, size, decay, etc.)
 */
import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import {
    type DeviceLayoutProps,
    SectionHeader,
    filterParams,
    registerDeviceLayout,
} from '../deviceLayoutRegistry';
import { DeviceParameterControl } from '../DeviceParameterControl';
import { CompressorCurve } from '../../../components/CompressorCurve';
import { ReverbDecay } from '../../../components/ReverbDecay';
import { DelayTaps } from '../../../components/DelayTaps';
import { setDeviceParameter } from '#/modules/Arrangement/useCases/device/setDeviceParameter';

type P = DeviceLayoutProps['parameters'][number];
const Param = ({ p, device, trackId }: { p: P; device: DeviceLayoutProps['device']; trackId: string }): ReactElement => (
    <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2 w-full">
        <DeviceParameterControl param={p} device={device} trackId={trackId} />
    </Card>
);

// ── Native EQ (4-band) ──────────────────────────────────────────────────

const NativeEQLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => (
    <div className="space-y-3">
        <SectionHeader title="Band 1" />
        <div className="grid grid-cols-2 gap-2">
            {filterParams(parameters, ['band2_gain', 'band2_freq']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
        </div>
        {filterParams(parameters, ['band2_q']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}

        <SectionHeader title="Band 2" />
        <div className="grid grid-cols-2 gap-2">
            {filterParams(parameters, ['band3_gain', 'band3_freq']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
        </div>
        {filterParams(parameters, ['band3_q']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}

        <SectionHeader title="Band 3" />
        <div className="grid grid-cols-2 gap-2">
            {filterParams(parameters, ['band4_gain', 'band4_freq']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
        </div>
        {filterParams(parameters, ['band4_q']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}

        <SectionHeader title="Band 4" />
        <div className="grid grid-cols-2 gap-2">
            {filterParams(parameters, ['band5_gain', 'band5_freq']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
        </div>
        {filterParams(parameters, ['band5_q']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}

        {filterParams(parameters, ['gain']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
    </div>
);

// ── Native Compressor ───────────────────────────────────────────────────

const NativeCompressorLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const change = (id: string, v: number): void => { setDeviceParameter(device.id, id, v); };

    return (
        <div className="space-y-3">
            <SectionHeader title="Transfer Curve" />
            <div className="flex justify-center">
                <CompressorCurve
                    threshold={pv['threshold'] ?? -20} ratio={pv['ratio'] ?? 4}
                    knee={pv['knee'] ?? 6} makeup={pv['makeup'] ?? 0}
                    width={140} height={140} onParamChange={change}
                />
            </div>
            <SectionHeader title="Controls" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['threshold', 'ratio']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['attack', 'release']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['knee', 'makeup']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
            </div>
        </div>
    );
};

// ── Native Reverb ───────────────────────────────────────────────────────

const NativeReverbLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;

    return (
        <div className="space-y-3">
            <SectionHeader title="Impulse Response" />
            <div className="flex justify-center">
                <ReverbDecay
                    size={pv['size'] ?? 0.5} decay={pv['decay'] ?? 2}
                    damping={pv['damping'] ?? 0.5} predelay={0}
                    width={240} height={70}
                />
            </div>
            <SectionHeader title="Controls" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['size', 'decay']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['damping', 'mix']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
            </div>
        </div>
    );
};

// ── Native Delay ────────────────────────────────────────────────────────

const NativeDelayLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const pv = device.parameterValues;
    const change = (id: string, v: number): void => { setDeviceParameter(device.id, id, v); };

    return (
        <div className="space-y-3">
            <SectionHeader title="Echo Pattern" />
            <div className="flex justify-center">
                <DelayTaps
                    time={pv['time_l'] ?? 250} feedback={pv['feedback'] ?? 0.4}
                    mix={pv['mix'] ?? 0.3} width={240} height={60} onParamChange={change}
                />
            </div>
            <SectionHeader title="Controls" />
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['time_l', 'time_r']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {filterParams(parameters, ['feedback', 'mix']).map((p) => <Param key={p.id} p={p} device={device} trackId={trackId} />)}
            </div>
        </div>
    );
};

// ── Register ────────────────────────────────────────────────────────────

registerDeviceLayout('native-eq', NativeEQLayout);
registerDeviceLayout('native-compressor', NativeCompressorLayout);
registerDeviceLayout('native-reverb', NativeReverbLayout);
registerDeviceLayout('native-delay', NativeDelayLayout);
// native-limiter, native-gate, native-gain use GenericDeviceLayout (few params, auto-groups well)
