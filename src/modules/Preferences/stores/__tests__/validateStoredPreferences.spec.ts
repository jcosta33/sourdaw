import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { defaultPreferences } from '../../models/Preferences';
import { validateStoredPreferences } from '../preferencesStore';

describe('validateStoredPreferences', () => {
    beforeEach(() => {
        // Rejected fields are logged via logger.warn; silence it so the test output
        // stays clean and the assertions stand on the returned value alone.
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    it('replaces a corrupt enum field (theme: null) with its default', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, theme: null });

        expect(result.theme).toBe(defaultPreferences.theme);
    });

    it('replaces an unknown audio latency profile with its default', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, audioLatencyProfile: 'unsupported' });

        expect(result.audioLatencyProfile).toBe(defaultPreferences.audioLatencyProfile);
    });

    it('preserves valid stored fields that differ from the defaults', () => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            theme: 'light',
            audioLatencyProfile: 'high-capacity',
            autoSave: false,
        });

        expect(result.theme).toBe('light');
        expect(result.audioLatencyProfile).toBe('high-capacity');
        expect(result.autoSave).toBe(false);
    });

    it('returns all defaults for non-object input', () => {
        expect(validateStoredPreferences(null)).toEqual(defaultPreferences);
        expect(validateStoredPreferences('not-an-object')).toEqual(defaultPreferences);
        expect(validateStoredPreferences(42)).toEqual(defaultPreferences);
    });

    it('returns a distinct copy that does not mutate defaultPreferences', () => {
        // Capture the canonical defaults before any mutation so we can prove they survive.
        const themeBefore = defaultPreferences.theme;
        const audioLatencyProfileBefore = defaultPreferences.audioLatencyProfile;

        const result = validateStoredPreferences({ ...defaultPreferences });

        // The returned object must not be the shared defaults reference, and writing
        // non-default values through it must not leak back into the canonical defaults.
        expect(result).not.toBe(defaultPreferences);
        result.theme = 'light';
        result.audioLatencyProfile = 'high-capacity';
        expect(defaultPreferences.theme).toBe(themeBefore);
        expect(defaultPreferences.audioLatencyProfile).toBe(audioLatencyProfileBefore);
    });
});

describe('validateStoredPreferences — per-field schema guards', () => {
    beforeEach(() => {
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    it('replaces an out-of-range numeric-enum recordCountIn with its default', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, recordCountIn: 3 });

        expect(result.recordCountIn).toBe(defaultPreferences.recordCountIn);
    });

    it('preserves a valid recordCountIn from its allowed set', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, recordCountIn: 4 });

        expect(result.recordCountIn).toBe(4);
    });

    it('replaces an out-of-range preRollBars with its default', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, preRollBars: 3 });

        expect(result.preRollBars).toBe(defaultPreferences.preRollBars);
    });

    it('preserves a valid preRollBars from its allowed set', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, preRollBars: 4 });

        expect(result.preRollBars).toBe(4);
    });

    it('accepts midiInputChannel as the literal "all"', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, midiInputChannel: 'all' });

        expect(result.midiInputChannel).toBe('all');
    });

    it('accepts midiInputChannel as a finite channel number', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, midiInputChannel: 7 });

        expect(result.midiInputChannel).toBe(7);
    });

    it('replaces a non-finite midiInputChannel with its default', () => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            midiInputChannel: Number.POSITIVE_INFINITY,
        });

        expect(result.midiInputChannel).toBe(defaultPreferences.midiInputChannel);
    });

    it('replaces an unknown soloMode value with its default', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, soloMode: 'invalid-mode' });

        expect(result.soloMode).toBe(defaultPreferences.soloMode);
    });

    it('preserves each valid soloMode value', () => {
        expect(validateStoredPreferences({ ...defaultPreferences, soloMode: 'afl' }).soloMode).toBe('afl');
        expect(validateStoredPreferences({ ...defaultPreferences, soloMode: 'pfl' }).soloMode).toBe('pfl');
    });

    it('replaces an invalid panel placement with its default, per panel', () => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            panelPlacementSidebar: 'center',
            panelPlacementInspector: 'center',
            panelPlacementChat: 'center',
            panelPlacementAi: 'center',
        });

        expect(result.panelPlacementSidebar).toBe(defaultPreferences.panelPlacementSidebar);
        expect(result.panelPlacementInspector).toBe(defaultPreferences.panelPlacementInspector);
        expect(result.panelPlacementChat).toBe(defaultPreferences.panelPlacementChat);
        expect(result.panelPlacementAi).toBe(defaultPreferences.panelPlacementAi);
    });

    it('preserves a valid non-default panel placement', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, panelPlacementSidebar: 'right' });

        expect(result.panelPlacementSidebar).toBe('right');
    });

    it('replaces a gridSubdivision outside the known option set with its default', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, gridSubdivision: 'triplet' });

        expect(result.gridSubdivision).toBe(defaultPreferences.gridSubdivision);
    });

    it('preserves a valid gridSubdivision override', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, gridSubdivision: '1/16' });

        expect(result.gridSubdivision).toBe('1/16');
    });

    it('replaces non-boolean values for every boolean field with their defaults', () => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            colorblindMode: 'yes',
            snapToGrid: 1,
            snapToZeroCrossing: null,
            showMinimap: 'true',
            metronomeEnabled: 0,
            preRollEnabled: 'false',
        });

        expect(result.colorblindMode).toBe(defaultPreferences.colorblindMode);
        expect(result.snapToGrid).toBe(defaultPreferences.snapToGrid);
        expect(result.snapToZeroCrossing).toBe(defaultPreferences.snapToZeroCrossing);
        expect(result.showMinimap).toBe(defaultPreferences.showMinimap);
        expect(result.metronomeEnabled).toBe(defaultPreferences.metronomeEnabled);
        expect(result.preRollEnabled).toBe(defaultPreferences.preRollEnabled);
    });

    it('preserves true boolean overrides that differ from the defaults', () => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            colorblindMode: true,
            showMinimap: true,
            metronomeEnabled: true,
            preRollEnabled: true,
        });

        expect(result.colorblindMode).toBe(true);
        expect(result.showMinimap).toBe(true);
        expect(result.metronomeEnabled).toBe(true);
        expect(result.preRollEnabled).toBe(true);
    });

    it('replaces non-finite numeric fields with their defaults', () => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            autoSaveIntervalMs: 'soon',
            metronomeVolume: Number.NaN,
            defaultVelocity: undefined,
        });

        expect(result.autoSaveIntervalMs).toBe(defaultPreferences.autoSaveIntervalMs);
        expect(result.metronomeVolume).toBe(defaultPreferences.metronomeVolume);
        expect(result.defaultVelocity).toBe(defaultPreferences.defaultVelocity);
    });

    it('preserves valid finite numeric overrides', () => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            autoSaveIntervalMs: 60_000,
            metronomeVolume: 0.9,
            defaultVelocity: 64,
        });

        expect(result.autoSaveIntervalMs).toBe(60_000);
        expect(result.metronomeVolume).toBe(0.9);
        expect(result.defaultVelocity).toBe(64);
    });

    it('replaces a non-string voiceCommandKey with its default', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, voiceCommandKey: 42 });

        expect(result.voiceCommandKey).toBe(defaultPreferences.voiceCommandKey);
    });

    it('preserves a valid voiceCommandKey override', () => {
        const result = validateStoredPreferences({ ...defaultPreferences, voiceCommandKey: 'm' });

        expect(result.voiceCommandKey).toBe('m');
    });
});

describe('validateStoredPreferences — fields absent from a partial stored blob', () => {
    beforeEach(() => {
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    it('falls back to defaults for keys missing from an older/partial persisted blob', () => {
        // Simulates an upgrade: an older persisted blob only carries a subset of the
        // current schema's keys. Every absent key must fall through to its default
        // (not become `undefined`), while present valid keys are preserved as-is.
        const result = validateStoredPreferences({ theme: 'light', audioLatencyProfile: 'high-capacity' });

        expect(result.theme).toBe('light');
        expect(result.audioLatencyProfile).toBe('high-capacity');
        expect(result.autoSave).toBe(defaultPreferences.autoSave);
        expect(result.soloMode).toBe(defaultPreferences.soloMode);
        expect(result.panelPlacementSidebar).toBe(defaultPreferences.panelPlacementSidebar);
    });

    it('migrates legacy pseudo buffer settings to the real low-latency profile', () => {
        const result = validateStoredPreferences({
            preferencesSchemaVersion: 1,
            bufferSize: 2048,
            sampleRate: 96_000,
        });

        expect(result.audioLatencyProfile).toBe('low-latency');
        expect(result.preferencesSchemaVersion).toBe(2);
        expect('bufferSize' in result).toBe(false);
        expect('sampleRate' in result).toBe(false);
    });

    it('preserves future-schema fields and version while validating fields this build understands', () => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            preferencesSchemaVersion: 3,
            audioLatencyProfile: 'high-capacity',
            futureAudioMode: 'adaptive',
        });

        expect(result.preferencesSchemaVersion).toBe(3);
        expect(result.audioLatencyProfile).toBe('high-capacity');
        expect(Reflect.get(result, 'futureAudioMode')).toBe('adaptive');
    });

    it('returns the full default set for an empty stored object', () => {
        expect(validateStoredPreferences({})).toEqual(defaultPreferences);
    });
});

describe('validateStoredPreferences — timeline minimap migration', () => {
    beforeEach(() => {
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    it('preserves the historically visible minimap for a legacy blob whose false value was never consumed', () => {
        const result = validateStoredPreferences({
            theme: 'light',
            showMinimap: false,
        });

        expect(result.showMinimap).toBe(true);
        expect(result.timelineMinimapHeight).toBe(28);
        expect(result.preferencesSchemaVersion).toBe(2);
    });

    it('honors an explicit hidden choice after the schema-aware migration', () => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            preferencesSchemaVersion: 1,
            showMinimap: false,
            timelineMinimapHeight: 72,
        });

        expect(result.showMinimap).toBe(false);
        expect(result.timelineMinimapHeight).toBe(72);
        expect(result.preferencesSchemaVersion).toBe(2);
    });

    it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null])(
        'migrates hidden state to visible when the schema version %s is corrupt',
        (preferencesSchemaVersion) => {
            const result = validateStoredPreferences({
                ...defaultPreferences,
                preferencesSchemaVersion,
                showMinimap: false,
            });

            expect(result.preferencesSchemaVersion).toBe(2);
            expect(result.showMinimap).toBe(true);
        }
    );

    it.each([
        { input: 72.7, expected: 73 },
        { input: -10, expected: 28 },
        { input: 900, expected: 160 },
        { input: Number.NaN, expected: 28 },
        { input: Number.POSITIVE_INFINITY, expected: 28 },
        { input: '72', expected: 28 },
    ])('normalizes stored minimap height $input to $expected', ({ input, expected }) => {
        const result = validateStoredPreferences({
            ...defaultPreferences,
            timelineMinimapHeight: input,
        });

        expect(result.timelineMinimapHeight).toBe(expected);
    });
});
