import { type ActionHandler } from '../models/ActionHandler';
import { type AppAction } from '../models/AppAction';
import {
    addDevice,
    removeDevice,
    bypassDevice,
    setSend,
    removeSend,
    setDeviceParameter,
} from '#/modules/Track/useCases/deviceUseCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { getTrackStoreState } from '#/modules/Track/useCases/trackQueries';
import { getLatencyReport } from '#/modules/AudioEngine/useCases/latencyCompensation';
import { setMpeEnabled } from '#/modules/AudioEngine/useCases/webMidiInput';
import {
    addSidechainRoute,
    removeSidechainRoute as removeSidechainRouteUseCase,
    getSidechainRoutesForTrack,
} from '#/modules/AudioEngine/useCases/sidechainUseCases';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const deviceHandlers = {
    addDevice: {
        execute: (a) => {
            addDevice(a.payload.trackId, a.payload.deviceType);
        },
        describe: (a) => ({ label: `Add ${a.payload.deviceType}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addDevice'>>,

    bypassDevice: {
        execute: (a) => {
            bypassDevice(a.payload.deviceId, a.payload.bypassed);
        },
        describe: (a) => ({ label: a.payload.bypassed ? 'Bypass device' : 'Enable device' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'bypassDevice'>>,

    removeDevice: {
        execute: (a) => {
            removeDevice(a.payload.deviceId);
        },
        describe: () => ({ label: 'Remove device' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeDevice'>>,

    setDeviceParameter: {
        execute: (a) => {
            setDeviceParameter(a.payload.deviceId, a.payload.paramId, a.payload.value);
            const ownerTrackId =
                getTrackStoreState()?.tracks.find((t) => t.devices.some((d) => d.id === a.payload.deviceId))?.id ?? '';
            updateDeviceParam(ownerTrackId, a.payload.deviceId, a.payload.paramId, a.payload.value);
        },
        describe: (a) => ({ label: `Set ${a.payload.paramId}` }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setDeviceParameter'>>,

    setSend: {
        execute: (a) => {
            setSend(a.payload.trackId, a.payload.busId, a.payload.level);
        },
        describe: () => ({ label: 'Set send level' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'setSend'>>,

    addSend: {
        execute: (a) => {
            setSend(a.payload.trackId, a.payload.busId, a.payload.level);
        },
        describe: () => ({ label: 'Add send' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addSend'>>,

    removeSend: {
        execute: (a) => {
            removeSend(a.payload.trackId, a.payload.busId);
        },
        describe: () => ({ label: 'Remove send' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeSend'>>,

    enableMpe: {
        execute: () => {
            setMpeEnabled(true);
        },
        describe: () => ({ label: 'Enable MPE' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'enableMpe'>>,

    disableMpe: {
        execute: () => {
            setMpeEnabled(false);
        },
        describe: () => ({ label: 'Disable MPE' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'disableMpe'>>,

    getLatencyReport: {
        execute: () => {
            const report = getLatencyReport();
            const maxMs = report.maxLatencyMs.toFixed(1);
            const baseMs = report.contextBaseLatencyMs.toFixed(1);
            const trackLines = report.tracks
                .filter((t) => t.deviceLatencyMs > 0)
                .map((t) => `${t.trackId}: ${t.totalLatencyMs.toFixed(1)}ms`)
                .join(', ');
            const detail = trackLines
                ? `Max: ${maxMs}ms, Base: ${baseMs}ms — ${trackLines}`
                : `Max: ${maxMs}ms, Base: ${baseMs}ms — no device latency`;
            document.dispatchEvent(
                new CustomEvent('webdaw:notify', {
                    detail: { message: `Latency Report: ${detail}`, level: 'info' },
                })
            );
        },
        describe: () => ({ label: 'Get latency report' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'getLatencyReport'>>,

    addSidechainRoute: {
        execute: (a) => {
            const targetTrack = getTrackStoreState()?.tracks.find((t) => t.id === a.payload.targetTrackId);
            const scDevice = targetTrack?.devices.find((d) => d.type.toLowerCase().includes('sidechain'));
            if (scDevice) {
                addSidechainRoute(a.payload.sourceTrackId, a.payload.targetTrackId, scDevice.id);
            }
        },
        describe: () => ({ label: 'Add sidechain route' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'addSidechainRoute'>>,

    removeSidechainRoute: {
        execute: (a) => {
            const routes = getSidechainRoutesForTrack(a.payload.targetTrackId);
            const route = routes.find((r) => r.sourceTrackId === a.payload.sourceTrackId);
            if (route) {
                removeSidechainRouteUseCase(route.id);
            }
        },
        describe: () => ({ label: 'Remove sidechain route' }),
        undoable: true,
    } satisfies ActionHandler<Extract<AppAction, 'removeSidechainRoute'>>,
};
