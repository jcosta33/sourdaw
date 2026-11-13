export type SoundEvent =
    | { frame: number; type: 'on' | 'off'; channel: number; pitch: number; velocity: number }
    | { frame: number; type: 'parameter'; name: string; value: number };

export type SoundProfile = {
    id: string;
    file: string;
    sampleRate: number;
    blockSize: number;
    frames: number;
    input: 'stereo-programme' | 'stereo-impulses' | 'eq-probe' | 'amplitude-steps';
    controls: Record<string, number>;
    events: SoundEvent[];
};

/** Integer frames include sub-quantum releases and retriggers; no wall-clock scheduling. */
function notes(sampleRate: number, pitch = 69, channel = 0): SoundEvent[] {
    return [
        { frame: 137, type: 'on', channel, pitch, velocity: 100 },
        { frame: Math.floor(sampleRate / 5) + 17, type: 'on', channel, pitch: pitch + 3, velocity: 32 },
        { frame: Math.floor(sampleRate / 3) + 7, type: 'off', channel, pitch, velocity: 0 },
        { frame: Math.floor(sampleRate / 2) + 19, type: 'off', channel, pitch: pitch + 3, velocity: 0 },
        { frame: Math.floor(sampleRate * 0.6) + 3, type: 'on', channel, pitch, velocity: 127 },
        { frame: Math.floor(sampleRate * 0.8) + 11, type: 'off', channel, pitch, velocity: 0 },
    ];
}

function profile(
    file: string,
    label: string,
    sampleRate: number,
    controls: Record<string, number> = {},
    options: Partial<Pick<SoundProfile, 'blockSize' | 'input' | 'events'>> & { seconds?: number } = {}
): SoundProfile {
    const blockSize = options.blockSize ?? 128;
    return {
        id: `${file.replace('.dsp', '')}-${label}-${sampleRate}-${blockSize}`,
        file,
        sampleRate,
        blockSize,
        frames: Math.ceil(((options.seconds ?? 1.4) * sampleRate) / blockSize) * blockSize,
        input: options.input ?? 'stereo-programme',
        controls,
        events: options.events ?? [],
    };
}

/** Baseline census is supplied by the real public registrations, checked against both source directories. */
export function faustSoundProfiles(shipped: { file: string; instrument: boolean }[]): SoundProfile[] {
    const defaults = shipped.map(({ file, instrument }) => {
        const tail = ['spring-reverb.dsp', 'zita-rev1.dsp', 'tape-delay.dsp'].includes(file);
        return profile(
            file,
            'defaults',
            48_000,
            {},
            {
                events: instrument ? notes(48_000) : [],
                input: tail ? 'stereo-impulses' : 'amplitude-steps',
                seconds: tail ? 3 : 1.4,
            }
        );
    });
    const diagnostics: SoundProfile[] = [];
    for (const rate of [44_100, 96_000]) {
        for (const q of [1, 10]) {
            diagnostics.push(
                profile(
                    'pro-parametric-eq.dsp',
                    `boost-q${q}`,
                    rate,
                    { mf_gain: 18, mf_freq: 1000, mf_q: q },
                    {
                        input: 'eq-probe',
                        seconds: 0.4,
                    }
                )
            );
        }
    }
    for (const algorithm of [1, 2, 3]) {
        diagnostics.push(
            profile('fm-synth.dsp', `algorithm${algorithm}`, 48_000, { algorithm }, { events: notes(48_000) })
        );
    }
    for (const [index, morph] of [1 / 3, 2 / 3, 1].entries()) {
        diagnostics.push(
            profile('morphing-synth.dsp', `wave${index + 1}`, 48_000, { morph }, { events: notes(48_000) })
        );
    }
    diagnostics.push(
        profile(
            'minimoog-lead.dsp',
            'envelope-retrigger',
            44_100,
            { attack: 0.05, decay: 0.1, sustain: 0.4, release: 0.2 },
            { events: notes(44_100), blockSize: 512 }
        ),
        profile(
            'supersaw-unison.dsp',
            'filter-low',
            48_000,
            { cutoff: 100, resonance: 0.9 },
            { events: notes(48_000) }
        ),
        profile(
            'supersaw-unison.dsp',
            'filter-high',
            96_000,
            { cutoff: 20_000, detune: 100 },
            { events: notes(96_000) }
        ),
        profile(
            'additive-synth.dsp',
            'high-pitch',
            192_000,
            { rolloff: 0.5 },
            { events: notes(192_000, 116), seconds: 1.4 }
        ),
        profile(
            'physical-model-string.dsp',
            'fractional-delay',
            44_100,
            { damping: 0.2, body: 0.9 },
            { events: notes(44_100, 81), blockSize: 512 }
        ),
        profile('rhodes.dsp', 'nonzero-channel-release', 48_000, {}, { events: notes(48_000, 69, 5) }),
        profile(
            'multiband-compressor.dsp',
            'crossover-corners',
            44_100,
            { crossover_low: 500, crossover_high: 10_000 },
            { input: 'amplitude-steps' }
        ),
        profile('de-esser.dsp', 'listen-filter', 96_000, { frequency: 12_000, bandwidth: 0.5, listen: 1 }),
        profile('stereo-widener.dsp', 'mono-bass', 44_100, { width: 175, mono_bass: 500 }),
        profile(
            'noise-gate.dsp',
            'hold-release',
            96_000,
            { threshold: -25, hold: 0.05, release: 0.2 },
            { input: 'amplitude-steps' }
        ),
        profile(
            'brick-wall-limiter.dsp',
            'fixed-latency',
            96_000,
            { ceiling: -6, lookahead: 0 },
            { input: 'stereo-impulses', seconds: 0.1 }
        )
    );
    for (const rate of [44_100, 96_000, 192_000]) {
        diagnostics.push(
            profile(
                'spring-reverb.dsp',
                'wet-tail',
                rate,
                { mix: 1, decay: 2, brightness: 0.5 },
                { input: 'stereo-impulses', seconds: 2 }
            ),
            profile(
                'zita-rev1.dsp',
                'wet-tail',
                rate,
                { dry_wet: 1, decay_time: 3, damping: 6000 },
                { input: 'stereo-impulses', seconds: 2 }
            ),
            profile(
                'tape-delay.dsp',
                'delay-capacity',
                rate,
                { dry_wet: 1, delay: 2, feedback: 0.5, tone: 500 },
                { input: 'stereo-impulses', seconds: 2.2 }
            )
        );
    }
    return [...defaults, ...diagnostics];
}
