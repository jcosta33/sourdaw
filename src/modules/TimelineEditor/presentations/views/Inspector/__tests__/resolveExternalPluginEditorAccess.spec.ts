import { describe, expect, it } from 'vitest';

import { type ExternalPluginActivationStatus } from '#/modules/PluginHost/stores';
import { isSupportedPluginFormat } from '#/modules/PluginHost/useCases';

import { type Device } from '../../../../models/TrackViewTypes';
import {
    type ExternalPluginEditorAccess,
    resolveExternalPluginEditorAccess,
    type SupportedScannedPlugin,
} from '../resolveExternalPluginEditorAccess';

type ScannedEntry = SupportedScannedPlugin & { format: string };
type Activations = Readonly<Record<string, ExternalPluginActivationStatus>>;
type EditorAccessRow = {
    case: string;
    plugins: ScannedEntry[];
    device: Pick<Device, 'externalPluginId' | 'externalInstanceId'>;
    activations: Activations;
    expected: ExternalPluginEditorAccess;
};

const clap: ScannedEntry = {
    id: 'reverb-plugin',
    descriptor_id: 'com.vendor.reverb',
    format: 'clap',
    has_custom_ui: true,
};
const device = (overrides: Partial<Device> = {}): Pick<Device, 'externalPluginId' | 'externalInstanceId'> => ({
    externalPluginId: 'reverb-plugin',
    externalInstanceId: 'instance-1',
    ...overrides,
});
const active: Activations = { 'instance-1': { status: 'active' } };
const supported = (scanned: readonly ScannedEntry[]): ScannedEntry[] =>
    scanned.filter((plugin) => isSupportedPluginFormat(plugin.format));

describe('resolveExternalPluginEditorAccess', () => {
    const rows: EditorAccessRow[] = [
        {
            case: 'an active plugin with an editor',
            plugins: [clap],
            device: device(),
            activations: active,
            expected: 'openable',
        },
        {
            case: 'a plugin matched by its descriptor id',
            plugins: [clap],
            device: device({ externalPluginId: 'com.vendor.reverb' }),
            activations: active,
            expected: 'openable',
        },
        {
            case: 'an active plugin whose editor capability is unqueried',
            plugins: [{ ...clap, has_custom_ui: false, capability_metadata_reason: 'scan timed out' }],
            device: device(),
            activations: active,
            expected: 'openable',
        },
        {
            case: 'an active plugin the scan reports has no editor',
            plugins: [{ ...clap, has_custom_ui: false }],
            device: device(),
            activations: active,
            expected: 'no-editor',
        },
        {
            case: 'a plugin still loading',
            plugins: [clap],
            device: device(),
            activations: { 'instance-1': { status: 'loading' } },
            expected: 'not-loaded',
        },
        {
            case: 'a plugin whose activation failed',
            plugins: [clap],
            device: device(),
            activations: { 'instance-1': { status: 'error', message: 'refused' } },
            expected: 'not-loaded',
        },
        {
            case: 'a device with no activation entry',
            plugins: [clap],
            device: device(),
            activations: {},
            expected: 'not-loaded',
        },
        {
            case: 'a device with no instance id',
            plugins: [clap],
            device: device({ externalInstanceId: undefined }),
            activations: active,
            expected: 'not-loaded',
        },
        {
            case: 'a device with no plugin id',
            plugins: [clap],
            device: device({ externalPluginId: undefined }),
            activations: active,
            expected: 'not-loaded',
        },
        {
            case: 'a plugin missing from the scan',
            plugins: [clap],
            device: device({ externalPluginId: 'unscanned-plugin' }),
            activations: active,
            expected: 'not-loaded',
        },
        {
            case: 'a plugin in an unsupported format',
            plugins: [{ ...clap, format: 'lv2' }],
            device: device(),
            activations: active,
            expected: 'not-loaded',
        },
    ];

    it.each(rows)('$case is $expected', ({ plugins, device: target, activations, expected }) => {
        expect(resolveExternalPluginEditorAccess(target, supported(plugins), activations)).toBe(expected);
    });
});
