import { describe, expect, it } from 'vitest';

import { DELIVERY_PRESETS } from '../../models/DeliveryPresets';
import { resolveDeliveryTargets } from '../resolveDeliveryTargets';

function row(index: number) {
    const preset = DELIVERY_PRESETS[index]!;
    return { id: preset.id, name: preset.name, settings: preset.settings, dither: { mode: 'none' as const } };
}

describe('resolveDeliveryTargets', () => {
    it('resolves source policies from the captured engine rate without changing other tuples', () => {
        const result = resolveDeliveryTargets({ targets: [row(0), row(2), row(3)], sourceSampleRate: 96000 });
        expect(result.map((target) => target.sampleRate)).toEqual([96000, 48000, 44100]);
        expect(result.map((target) => target.targetLufs)).toEqual([-14, -14, -16]);
        expect(row(0).settings.sampleRate).toBe('source');
    });
    it('refuses unknown source rate, invalid names, duplicate IDs and unsupported codec tuples', () => {
        expect(() => resolveDeliveryTargets({ targets: [row(0)] })).toThrow(/source sample rate/i);
        expect(() => resolveDeliveryTargets({ targets: [row(2), row(2)] })).toThrow(/duplicate/i);
        expect(() => resolveDeliveryTargets({ targets: [{ ...row(2), id: '../unsafe' }] })).toThrow(/target id/i);
        const podcast = row(3);
        expect(() =>
            resolveDeliveryTargets({
                targets: [{ ...podcast, settings: { ...podcast.settings, formats: ['flac'], bitDepth: 32 } }],
            })
        ).toThrow(/FLAC/i);
        expect(() =>
            resolveDeliveryTargets({
                targets: [
                    { ...podcast, settings: { ...podcast.settings, mp3BitRate: 96, sampleRate: 48000, channels: 2 } },
                ],
            })
        ).toThrow(/96.*stereo/i);
        expect(() =>
            resolveDeliveryTargets({ targets: [{ ...podcast, settings: { ...podcast.settings, sampleRate: 96000 } }] })
        ).toThrow(/MP3.*rate/i);
    });
    it('validates every active episode before storage and returns a detached metadata snapshot', () => {
        const metadata = { title: 'Épisode 🌊', artist: 'José', description: '音楽' };
        const target = resolveDeliveryTargets({ targets: [{ ...row(3), metadata }] })[0]!;
        metadata.title = 'Later';
        expect(target.metadata?.title).toBe('Épisode 🌊');
        expect(() =>
            resolveDeliveryTargets({
                targets: [{ ...row(3), metadata: { title: 'bad\0title', artist: '', description: '' } }],
            })
        ).toThrow();
    });
});
