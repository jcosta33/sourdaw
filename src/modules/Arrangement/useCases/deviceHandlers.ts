import { notifyUser } from '#/helpers/Notification/notifyUser';
import { addDevice } from './device/addDevice';
import { removeDevice } from './device/removeDevice';
import { bypassDevice } from './device/bypassDevice';
import { setSend, removeSend } from './device/sendManagement';
import { setDeviceParameter } from './device/setDeviceParameter';
import { updateDeviceParam, getLatencyReport, setMpeEnabled } from '#/modules/AudioEngine';
import { getTrackStoreState } from './getTrackStoreState';
import {
    addSidechainRoute,
    removeSidechainRoute as removeSidechainRouteUseCase,
    getSidechainRoutesForTrack,
} from '#/modules/Routing';

type DeviceHandlerDescription = {
    label: string;
};

type DeviceHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => DeviceHandlerDescription;
    undoable: boolean;
};

type DeviceAction =
    | { type: 'addDevice'; payload: { trackId: string; deviceType: string } }
    | { type: 'bypassDevice'; payload: { deviceId: string; bypassed: boolean } }
    | { type: 'removeDevice'; payload: { deviceId: string } }
    | { type: 'setDeviceParameter'; payload: { deviceId: string; paramId: string; value: number } }
    | { type: 'setSend'; payload: { trackId: string; busId: string; level: number } }
    | { type: 'addSend'; payload: { trackId: string; busId: string; level: number } }
    | { type: 'removeSend'; payload: { trackId: string; busId: string } }
    | { type: 'enableMpe'; payload?: undefined }
    | { type: 'disableMpe'; payload?: undefined }
    | { type: 'getLatencyReport'; payload?: undefined }
    | { type: 'addSidechainRoute'; payload: { sourceTrackId: string; targetTrackId: string } }
    | { type: 'removeSidechainRoute'; payload: { sourceTrackId: string; targetTrackId: string } };

type DeviceActionOf<ActionType extends DeviceAction['type']> = Extract<DeviceAction, { type: ActionType }>;

type DeviceHandlers = {
    addDevice: DeviceHandler<DeviceActionOf<'addDevice'>>;
    bypassDevice: DeviceHandler<DeviceActionOf<'bypassDevice'>>;
    removeDevice: DeviceHandler<DeviceActionOf<'removeDevice'>>;
    setDeviceParameter: DeviceHandler<DeviceActionOf<'setDeviceParameter'>>;
    setSend: DeviceHandler<DeviceActionOf<'setSend'>>;
    addSend: DeviceHandler<DeviceActionOf<'addSend'>>;
    removeSend: DeviceHandler<DeviceActionOf<'removeSend'>>;
    enableMpe: DeviceHandler<DeviceActionOf<'enableMpe'>>;
    disableMpe: DeviceHandler<DeviceActionOf<'disableMpe'>>;
    getLatencyReport: DeviceHandler<DeviceActionOf<'getLatencyReport'>>;
    addSidechainRoute: DeviceHandler<DeviceActionOf<'addSidechainRoute'>>;
    removeSidechainRoute: DeviceHandler<DeviceActionOf<'removeSidechainRoute'>>;
};

export const deviceHandlers: DeviceHandlers = {
    addDevice: {
        execute: (a) => {
            addDevice(a.payload.trackId, a.payload.deviceType);
        },
        describe: (a) => ({ label: `Add ${a.payload.deviceType}` }),
        undoable: true,
    },

    bypassDevice: {
        execute: (a) => {
            bypassDevice(a.payload.deviceId, a.payload.bypassed);
        },
        describe: (a) => ({ label: a.payload.bypassed ? 'Bypass device' : 'Enable device' }),
        undoable: true,
    },

    removeDevice: {
        execute: (a) => {
            removeDevice(a.payload.deviceId);
        },
        describe: () => ({ label: 'Remove device' }),
        undoable: true,
    },

    setDeviceParameter: {
        execute: (a) => {
            setDeviceParameter(a.payload.deviceId, a.payload.paramId, a.payload.value);
            const ownerTrackId =
                getTrackStoreState()?.tracks.find((t) => t.devices.some((d) => d.id === a.payload.deviceId))?.id ?? '';
            updateDeviceParam(ownerTrackId, a.payload.deviceId, a.payload.paramId, a.payload.value);
        },
        describe: (a) => ({ label: `Set ${a.payload.paramId}` }),
        undoable: true,
    },

    setSend: {
        execute: (a) => {
            setSend(a.payload.trackId, a.payload.busId, a.payload.level);
        },
        describe: () => ({ label: 'Set send level' }),
        undoable: true,
    },

    addSend: {
        execute: (a) => {
            setSend(a.payload.trackId, a.payload.busId, a.payload.level);
        },
        describe: () => ({ label: 'Add send' }),
        undoable: true,
    },

    removeSend: {
        execute: (a) => {
            removeSend(a.payload.trackId, a.payload.busId);
        },
        describe: () => ({ label: 'Remove send' }),
        undoable: true,
    },

    enableMpe: {
        execute: () => {
            setMpeEnabled(true);
        },
        describe: () => ({ label: 'Enable MPE' }),
        undoable: false,
    },

    disableMpe: {
        execute: () => {
            setMpeEnabled(false);
        },
        describe: () => ({ label: 'Disable MPE' }),
        undoable: false,
    },

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
            notifyUser(`Latency Report: ${detail}`);
        },
        describe: () => ({ label: 'Get latency report' }),
        undoable: false,
    },

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
    },

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
    },
};
