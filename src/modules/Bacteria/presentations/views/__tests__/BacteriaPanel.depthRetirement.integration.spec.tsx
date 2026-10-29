import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { bacteriaStore, getBacteriaState, setBacteriaUiLevel } from '../../../stores/bacteriaStore';
import { BacteriaPanel } from '../BacteriaPanel';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    updateDeviceParam: vi.fn(),
    updateDevicePatch: vi.fn(),
}));

const DEVICE_ID = 'legacy-bacteria';
const TRACK_ID = 'legacy-track';
const LEGACY_VALUES = {
    band0_distortionMode: 6,
    band0_breakdownDepth: 2.75,
    band1_distortionMode: 8,
    band1_breakdownDepth: 0.65,
    band0_drive: 28,
};

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function legacyTrack(): Track {
    return {
        id: TRACK_ID,
        name: 'Legacy guitar',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ff88',
        clips: [],
        devices: [
            {
                id: DEVICE_ID,
                name: 'Bacteria',
                type: 'bacteria',
                bypassed: false,
                parameterValues: LEGACY_VALUES,
            },
        ],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

function rawParameterValues(): Record<string, number> {
    flushAutomergeStorageWrites();
    const root = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root');
    const device = root?.tracks.tracks
        .find((track) => track.id === TRACK_ID)
        ?.devices.find((entry) => entry.id === DEVICE_ID);
    if (!device) {
        throw new Error('Expected the legacy Bacteria device in the raw project document');
    }
    return device.parameterValues;
}

function expectLegacyValues(values: Record<string, number>): void {
    expect(values).toMatchObject({
        band0_distortionMode: 6,
        band0_breakdownDepth: 2.75,
        band1_distortionMode: 8,
        band1_breakdownDepth: 0.65,
    });
}

describe('Bacteria Breakdown Depth retirement', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('legacy Bacteria depth retirement');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        bacteriaStore.set({});
        trackStore.set({ tracks: [legacyTrack()], selectedTrackId: TRACK_ID, ghostClips: [] });
        expectLegacyValues(rawParameterValues());
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        bacteriaStore.set({});
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('hides inert Depth for a hydrated breakdown band while retaining its saved identity and values through a typed Drive edit', async () => {
        render(<BacteriaPanel deviceId={DEVICE_ID} />);
        setBacteriaUiLevel(DEVICE_ID, 2);

        expect(await screen.findByRole('slider', { name: 'Drive' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'breakdown' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByRole('slider', { name: 'Depth' })).not.toBeInTheDocument();

        expect(getBacteriaState(DEVICE_ID).patch.bands[0]).toMatchObject({
            distortionMode: 'breakdown',
            breakdownDepth: 2.75,
        });
        expect(getBacteriaState(DEVICE_ID).patch.bands[1]).toMatchObject({
            distortionMode: 'custom',
            breakdownDepth: 0.65,
        });
        expectLegacyValues(rawParameterValues());

        await executeAppAction({
            type: 'setDeviceParameter',
            payload: { deviceId: DEVICE_ID, paramId: 'band0_drive', value: 63 },
        });
        await waitFor(() => expect(getBacteriaState(DEVICE_ID).patch.bands[0]?.drive).toBe(63));
        expect(rawParameterValues()).toMatchObject({ ...LEGACY_VALUES, band0_drive: 63 });
        expectLegacyValues(rawParameterValues());
    });

    it('keeps the selected band Drive control writable', async () => {
        render(<BacteriaPanel deviceId={DEVICE_ID} />);
        setBacteriaUiLevel(DEVICE_ID, 2);

        const drive = await screen.findByRole('slider', { name: 'Drive' });
        expect(drive).toHaveAttribute('aria-valuenow', '28');
        fireEvent.keyDown(drive, { key: 'ArrowUp' });
        await waitFor(() => expect(getBacteriaState(DEVICE_ID).patch.bands[0]?.drive).toBe(29));
        expect(getBacteriaState(DEVICE_ID).patch.bands[0]?.distortionMode).toBe('breakdown');
        expectLegacyValues(rawParameterValues());
    });
});
