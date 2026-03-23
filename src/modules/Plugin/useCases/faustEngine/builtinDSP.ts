/**
 * Built-in Faust DSP definitions.
 *
 * Each call to registerFaustDSP registers a Faust source + parameter descriptors
 * that can be compiled to WASM AudioWorkletNodes on demand.
 *
 * This file is ~900 lines of DSP source code and param descriptors.
 * Extracted from faustEngine.ts for maintainability.
 */

import { registerFaustDSP } from './compilerEngine';

export function registerBuiltinFaustDSP(): void {
    // ── Zita-Rev1 algorithmic reverb ──────────────────────────
    registerFaustDSP('Zita-Rev1 Reverb', `
        import("stdfaust.lib");
        process = re.zita_rev1_stereo(rdel, f1, f2, t60dc, t60m, fsmax)
        with { rdel = 60; f1 = 200; f2 = 6000; t60dc = 3; t60m = 2; fsmax = 48000; };
    `, [
        { address: '/zita/decay_time', label: 'Decay Time', min: 0.1, max: 15, defaultValue: 3, step: 0.1, type: 'hslider' },
        { address: '/zita/damping', label: 'Damping', min: 200, max: 12000, defaultValue: 6000, step: 100, type: 'hslider' },
        { address: '/zita/dry_wet', label: 'Dry/Wet', min: 0, max: 1, defaultValue: 0.3, step: 0.01, type: 'hslider' },
    ]);

    // ── 1176 compressor model ─────────────────────────────────
    registerFaustDSP('1176 Compressor', `
        import("stdfaust.lib");
        process = co.compressor_stereo(ratio, thresh, attack, release)
        with {
            ratio = hslider("ratio", 4, 1, 20, 0.1);
            thresh = hslider("threshold", -20, -60, 0, 0.1);
            attack = hslider("attack", 0.001, 0.0001, 0.1, 0.0001);
            release = hslider("release", 0.1, 0.01, 1, 0.001);
        };
    `, [
        { address: '/1176/ratio', label: 'Ratio', min: 1, max: 20, defaultValue: 4, step: 0.1, type: 'hslider' },
        { address: '/1176/threshold', label: 'Threshold', min: -60, max: 0, defaultValue: -20, step: 0.1, type: 'hslider' },
        { address: '/1176/attack', label: 'Attack', min: 0.0001, max: 0.1, defaultValue: 0.001, step: 0.0001, type: 'hslider' },
        { address: '/1176/release', label: 'Release', min: 0.01, max: 1, defaultValue: 0.1, step: 0.001, type: 'hslider' },
    ]);

    // ── Multiband compressor ──────────────────────────────────
    registerFaustDSP('Multiband Compressor', `
        import("stdfaust.lib");
        process = dm.compressor_demo;
    `, [
        { address: '/multiband/low_threshold', label: 'Low Threshold', min: -60, max: 0, defaultValue: -20, step: 0.5, type: 'hslider' },
        { address: '/multiband/mid_threshold', label: 'Mid Threshold', min: -60, max: 0, defaultValue: -15, step: 0.5, type: 'hslider' },
        { address: '/multiband/high_threshold', label: 'High Threshold', min: -60, max: 0, defaultValue: -10, step: 0.5, type: 'hslider' },
        { address: '/multiband/crossover_low', label: 'Low Crossover', min: 50, max: 500, defaultValue: 200, step: 10, type: 'hslider' },
        { address: '/multiband/crossover_high', label: 'High Crossover', min: 1000, max: 10000, defaultValue: 3000, step: 100, type: 'hslider' },
    ]);

    // ── Pro Parametric EQ ─────────────────────────────────────
    registerFaustDSP('Pro Parametric EQ', `
        import("stdfaust.lib");
        process = fi.low_shelf(lf_gain, lf_freq) :
                  fi.peak_eq(mf_gain, mf_freq, mf_q) :
                  fi.high_shelf(hf_gain, hf_freq);
    `, [
        { address: '/eq/lf_gain', label: 'Low Gain', min: -18, max: 18, defaultValue: 0, step: 0.1, type: 'hslider' },
        { address: '/eq/lf_freq', label: 'Low Freq', min: 20, max: 500, defaultValue: 100, step: 1, type: 'hslider' },
        { address: '/eq/mf_gain', label: 'Mid Gain', min: -18, max: 18, defaultValue: 0, step: 0.1, type: 'hslider' },
        { address: '/eq/mf_freq', label: 'Mid Freq', min: 200, max: 8000, defaultValue: 1000, step: 1, type: 'hslider' },
        { address: '/eq/mf_q', label: 'Mid Q', min: 0.1, max: 10, defaultValue: 1, step: 0.1, type: 'hslider' },
        { address: '/eq/hf_gain', label: 'High Gain', min: -18, max: 18, defaultValue: 0, step: 0.1, type: 'hslider' },
        { address: '/eq/hf_freq', label: 'High Freq', min: 1000, max: 20000, defaultValue: 8000, step: 100, type: 'hslider' },
    ]);

    // ── Tape Delay ────────────────────────────────────────────
    registerFaustDSP('Tape Delay', `
        import("stdfaust.lib");
        process = ef.echo(maxdel, delay, feedback)
        with {
            maxdel = 2.0;
            delay = hslider("delay", 0.3, 0.01, 2, 0.01);
            feedback = hslider("feedback", 0.5, 0, 0.95, 0.01);
        };
    `, [
        { address: '/tape_delay/delay', label: 'Delay Time', min: 0.01, max: 2, defaultValue: 0.3, step: 0.01, type: 'hslider' },
        { address: '/tape_delay/feedback', label: 'Feedback', min: 0, max: 0.95, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        { address: '/tape_delay/wow_flutter', label: 'Wow & Flutter', min: 0, max: 1, defaultValue: 0.3, step: 0.01, type: 'hslider' },
        { address: '/tape_delay/tone', label: 'Tone', min: 500, max: 12000, defaultValue: 4000, step: 100, type: 'hslider' },
    ]);

    // ── Brick-Wall Limiter ────────────────────────────────────
    registerFaustDSP('Brick-Wall Limiter', `
        import("stdfaust.lib");
        process = co.limiter_1176_R4_stereo;
    `, [
        { address: '/limiter/ceiling', label: 'Ceiling', min: -6, max: 0, defaultValue: -0.3, step: 0.1, type: 'hslider' },
        { address: '/limiter/release', label: 'Release', min: 10, max: 500, defaultValue: 100, step: 1, type: 'hslider' },
        { address: '/limiter/lookahead', label: 'Lookahead (ms)', min: 0, max: 10, defaultValue: 5, step: 0.5, type: 'hslider' },
    ]);

    // ── Spring Reverb ─────────────────────────────────────────
    registerFaustDSP('Spring Reverb', `
        import("stdfaust.lib");
        process = re.mono_freeverb(fb1, fb2, damp, spread);
    `, [
        { address: '/spring/decay', label: 'Decay', min: 0.1, max: 8, defaultValue: 2, step: 0.1, type: 'hslider' },
        { address: '/spring/brightness', label: 'Brightness', min: 0, max: 1, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        { address: '/spring/mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.25, step: 0.01, type: 'hslider' },
    ]);

    // ── FM Synth ──────────────────────────────────────────────
    registerFaustDSP('FM Synth', `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 10000, 0.1);
        gate = button("gate");
        ratio = hslider("ratio", 2, 0.5, 10, 0.1);
        index = hslider("index", 5, 0, 20, 0.1);
        process = os.osc(freq + os.osc(freq * ratio) * freq * index) * en.adsr(0.01, 0.1, 0.8, 0.5, gate) <: _, _;
    `, [
        { address: '/fm_synth/ratio', label: 'Ratio', min: 0.5, max: 10, defaultValue: 2, step: 0.1, type: 'hslider' },
        { address: '/fm_synth/index', label: 'Mod Index', min: 0, max: 20, defaultValue: 5, step: 0.1, type: 'hslider' },
    ]);

    // ── Rhodes Electric Piano ─────────────────────────────────
    registerFaustDSP('Rhodes', `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 10000, 0.1);
        gate = button("gate");
        velocity = hslider("velocity", 0.8, 0, 1, 0.01);
        index = 2 * velocity * en.ar(0.005, 0.5, gate);
        ratio = 1;
        mod = os.osc(freq * ratio) * freq * index;
        carrier = os.osc(freq + mod);
        env = en.adsr(0.005, 1.5, 0.2, 0.5, gate);
        process = carrier * env * velocity * 0.5 <: _, _;
    `, []);

    // ── Noise Gate ────────────────────────────────────────────
    registerFaustDSP('Noise Gate', `
        import("stdfaust.lib");
        process = co.gate_stereo(thresh, attack, hold, release)
        with {
            thresh = hslider("threshold", -60, -90, 0, 0.1);
            attack = hslider("attack", 0.001, 0.0001, 0.1, 0.0001);
            hold = hslider("hold", 0.01, 0, 0.5, 0.001);
            release = hslider("release", 0.1, 0.01, 1, 0.001);
        };
    `, [
        { address: '/Noise_Gate/threshold', label: 'Threshold', min: -90, max: 0, defaultValue: -60, step: 0.1, type: 'hslider' },
        { address: '/Noise_Gate/attack', label: 'Attack', min: 0.0001, max: 0.1, defaultValue: 0.001, step: 0.0001, type: 'hslider' },
        { address: '/Noise_Gate/hold', label: 'Hold', min: 0, max: 0.5, defaultValue: 0.01, step: 0.001, type: 'hslider' },
        { address: '/Noise_Gate/release', label: 'Release', min: 0.01, max: 1, defaultValue: 0.1, step: 0.001, type: 'hslider' },
    ]);

    // ── Gain Utility ──────────────────────────────────────────
    registerFaustDSP('Gain Utility', `
        import("stdfaust.lib");
        gain = hslider("gain", 0, -36, 36, 0.1) : ba.db2linear;
        invert = checkbox("invert_phase") : ba.if(-1, 1);
        width = hslider("width", 1, 0, 2, 0.01);
        width_ctrl(L,R) = mid + side*width, mid - side*width
        with { mid = (L+R)*0.5; side = (L-R)*0.5; };
        process = _,_ : *(gain) * invert, *(gain) * invert : width_ctrl;
    `, [
        { address: '/Gain_Utility/gain', label: 'Gain (dB)', min: -36, max: 36, defaultValue: 0, step: 0.1, type: 'hslider' },
        { address: '/Gain_Utility/invert_phase', label: 'Invert Phase', min: 0, max: 1, defaultValue: 0, step: 1, type: 'checkbox' },
        { address: '/Gain_Utility/width', label: 'Stereo Width', min: 0, max: 2, defaultValue: 1, step: 0.01, type: 'hslider' },
    ]);

    // ── Hammond B3 ────────────────────────────────────────────
    registerFaustDSP('Hammond B3', `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 6000, 0.01);
        gate = button("gate");
        d1 = hslider("drawbar_16", 8, 0, 8, 1);
        d2 = hslider("drawbar_8", 8, 0, 8, 1);
        d3 = hslider("drawbar_513", 0, 0, 8, 1);
        d4 = hslider("drawbar_4", 0, 0, 8, 1);
        d5 = hslider("drawbar_223", 0, 0, 8, 1);
        d6 = hslider("drawbar_2", 0, 0, 8, 1);
        d7 = hslider("drawbar_135", 0, 0, 8, 1);
        d8 = hslider("drawbar_113", 0, 0, 8, 1);
        d9 = hslider("drawbar_1", 0, 0, 8, 1);
        organ = os.osc(freq*0.5)*d1 + os.osc(freq)*d2 + os.osc(freq*1.5)*d3 +
                os.osc(freq*2.0)*d4 + os.osc(freq*3.0)*d5 + os.osc(freq*4.0)*d6 +
                os.osc(freq*5.0)*d7 + os.osc(freq*6.0)*d8 + os.osc(freq*8.0)*d9;
        tonewheel = organ / 72.0;
        leslie_speed = hslider("leslie_speed", 6.0, 0.1, 12.0, 0.1);
        leslie_depth = hslider("leslie_depth", 0.25, 0.0, 0.8, 0.01);
        leslie = tonewheel * (1.0 + leslie_depth * os.osc(leslie_speed));
        env = en.adsr(0.005, 0.0, 1.0, 0.03, gate);
        process = leslie * env * 0.7 <: _, _;
    `, [
        { address: '/Hammond_B3/drawbar_16', label: "16'", min: 0, max: 8, defaultValue: 8, step: 1, type: 'hslider' },
        { address: '/Hammond_B3/drawbar_8', label: "8'", min: 0, max: 8, defaultValue: 8, step: 1, type: 'hslider' },
        { address: '/Hammond_B3/drawbar_513', label: "5⅓'", min: 0, max: 8, defaultValue: 0, step: 1, type: 'hslider' },
        { address: '/Hammond_B3/drawbar_4', label: "4'", min: 0, max: 8, defaultValue: 0, step: 1, type: 'hslider' },
        { address: '/Hammond_B3/drawbar_223', label: "2⅔'", min: 0, max: 8, defaultValue: 0, step: 1, type: 'hslider' },
        { address: '/Hammond_B3/drawbar_2', label: "2'", min: 0, max: 8, defaultValue: 0, step: 1, type: 'hslider' },
        { address: '/Hammond_B3/drawbar_135', label: "1⅗'", min: 0, max: 8, defaultValue: 0, step: 1, type: 'hslider' },
        { address: '/Hammond_B3/drawbar_113', label: "1⅓'", min: 0, max: 8, defaultValue: 0, step: 1, type: 'hslider' },
        { address: '/Hammond_B3/drawbar_1', label: "1'", min: 0, max: 8, defaultValue: 0, step: 1, type: 'hslider' },
        { address: '/Hammond_B3/leslie_speed', label: 'Leslie Speed', min: 0.1, max: 12, defaultValue: 6, step: 0.1, type: 'hslider' },
        { address: '/Hammond_B3/leslie_depth', label: 'Leslie Depth', min: 0, max: 0.8, defaultValue: 0.25, step: 0.01, type: 'hslider' },
    ]);

    // ── Minimoog Lead ─────────────────────────────────────────
    registerFaustDSP('Minimoog Lead', `
        import("stdfaust.lib");
        freq = hslider("freq", 440, 20, 12000, 0.01);
        gate = button("gate");
        detune = hslider("detune", 7, 0, 50, 0.1);
        osc2lvl = hslider("osc2", 0.6, 0, 1, 0.01);
        cutoff = hslider("cutoff", 1800, 80, 18000, 1);
        res = hslider("resonance", 0.4, 0, 0.95, 0.01);
        env_amt = hslider("env_amount", 0.5, 0, 1, 0.01);
        atk = hslider("attack", 0.005, 0.001, 5, 0.001);
        dec = hslider("decay", 0.25, 0.01, 5, 0.01);
        sus = hslider("sustain", 0.6, 0, 1, 0.01);
        rel = hslider("release", 0.3, 0.01, 5, 0.01);
        osc1 = os.sawtooth(freq);
        osc2 = os.sawtooth(freq * pow(2, detune / 1200));
        mixed = osc1 + osc2 * osc2lvl;
        env = en.adsr(atk, dec, sus, rel, gate);
        dyn_cutoff = cutoff * (1 + env_amt * env * 3);
        filtered = fi.resonlp(dyn_cutoff, 1 + res * 12, mixed * 0.4);
        process = filtered * env * 0.8 <: _, _;
    `, [
        { address: '/Minimoog_Lead/detune', label: 'Osc2 Detune (¢)', min: 0, max: 50, defaultValue: 7, step: 0.1, type: 'hslider' },
        { address: '/Minimoog_Lead/osc2', label: 'Osc2 Level', min: 0, max: 1, defaultValue: 0.6, step: 0.01, type: 'hslider' },
        { address: '/Minimoog_Lead/cutoff', label: 'Filter Cutoff', min: 80, max: 18000, defaultValue: 1800, step: 1, type: 'hslider' },
        { address: '/Minimoog_Lead/resonance', label: 'Resonance', min: 0, max: 0.95, defaultValue: 0.4, step: 0.01, type: 'hslider' },
        { address: '/Minimoog_Lead/env_amount', label: 'Filter Env Amt', min: 0, max: 1, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        { address: '/Minimoog_Lead/attack', label: 'Attack', min: 0.001, max: 5, defaultValue: 0.005, step: 0.001, type: 'hslider' },
        { address: '/Minimoog_Lead/decay', label: 'Decay', min: 0.01, max: 5, defaultValue: 0.25, step: 0.01, type: 'hslider' },
        { address: '/Minimoog_Lead/sustain', label: 'Sustain', min: 0, max: 1, defaultValue: 0.6, step: 0.01, type: 'hslider' },
        { address: '/Minimoog_Lead/release', label: 'Release', min: 0.01, max: 5, defaultValue: 0.3, step: 0.01, type: 'hslider' },
    ]);

    // ── LUFS Meter (ITU-R BS.1770-4) ──────────────────────────
    registerFaustDSP('LUFS Meter', `
        import("stdfaust.lib");
        pre_a0 = 1.53512485958697; pre_a1 = -2.69169618940638;
        pre_a2 = 1.19839281085285; pre_b1 = -1.69065929318241; pre_b2 = 0.73248077421585;
        rlb_a0 = 1.0; rlb_a1 = -2.0; rlb_a2 = 1.0; rlb_b1 = -1.99004745483398; rlb_b2 = 0.99007225036621;
        kweight = fi.tf22t(pre_a0, pre_a1, pre_a2, pre_b1, pre_b2) : fi.tf22t(rlb_a0, rlb_a1, rlb_a2, rlb_b1, rlb_b2);
        ms_window(t) = ^(2) : si.smooth(ba.tau2pole(t));
        lufs(ms) = ba.if(ms > 1e-10, 10 * log10(ms) - 0.691, -70);
        momentary_ms = kweight : ms_window(0.4);
        shortterm_ms = kweight : ms_window(3.0);
        meter_ch(x) = x <: (_, momentary_ms, shortterm_ms) : (_, vbargraph("momentary", -70, 0), vbargraph("short_term", -70, 0));
        process = meter_ch, meter_ch;
    `, [
        { address: '/LUFS_Meter/momentary', label: 'Momentary (LUFS)', min: -70, max: 0, defaultValue: -70, step: 0.1, type: 'vbargraph' },
        { address: '/LUFS_Meter/short_term', label: 'Short-Term (LUFS)', min: -70, max: 0, defaultValue: -70, step: 0.1, type: 'vbargraph' },
    ]);

    // ── Stereo Widener (M/S) ──────────────────────────────────
    registerFaustDSP('Stereo Widener', `
        import("stdfaust.lib");
        width = hslider("width", 100, 0, 200, 1) / 100.0;
        mono_freq = hslider("mono_bass", 0, 0, 500, 1);
        mid(l, r) = (l + r) * 0.5;
        side(l, r) = (l - r) * 0.5;
        bass_mono(m, s) = m, (s * ba.if(mono_freq > 1, 1.0 - (fi.lowpass(1, mono_freq) : abs : si.smooth(0.999)), 1.0));
        process(l, r) = mid(l,r), side(l,r) : bass_mono : (*(1.0), *(width)) : (+(_, _), -(_, _));
    `, [
        { address: '/Stereo_Widener/width', label: 'Width (%)', min: 0, max: 200, defaultValue: 100, step: 1, type: 'hslider' },
        { address: '/Stereo_Widener/mono_bass', label: 'Mono Bass (Hz)', min: 0, max: 500, defaultValue: 0, step: 1, type: 'hslider' },
    ]);

    // ── De-esser ──────────────────────────────────────────────
    registerFaustDSP('De-esser', `
        import("stdfaust.lib");
        freq = hslider("frequency", 6000, 2000, 12000, 10);
        bw = hslider("bandwidth", 2.0, 0.5, 6.0, 0.1);
        thresh = hslider("threshold", -20, -60, 0, 0.5);
        ratio = hslider("ratio", 4, 1, 20, 0.5);
        atk = 0.001; rel = 0.05;
        listen = checkbox("listen");
        sc_signal = fi.resonbp(freq, bw, 1);
        env = sc_signal : abs : si.smooth(ba.tau2pole(atk)) : max(_, _ : si.smooth(ba.tau2pole(rel)));
        gr(e) = ba.if(e > ba.db2linear(thresh), pow(ba.db2linear(thresh) / e, 1 - 1.0/ratio), 1.0);
        deess(x) = x <: (sc_signal, _) : (env : gr, _) : select2(listen, *(_, _), (sc_signal));
        process = deess, deess;
    `, [
        { address: '/De-esser/frequency', label: 'Frequency (Hz)', min: 2000, max: 12000, defaultValue: 6000, step: 10, type: 'hslider' },
        { address: '/De-esser/bandwidth', label: 'Bandwidth (Q)', min: 0.5, max: 6.0, defaultValue: 2.0, step: 0.1, type: 'hslider' },
        { address: '/De-esser/threshold', label: 'Threshold (dB)', min: -60, max: 0, defaultValue: -20, step: 0.5, type: 'hslider' },
        { address: '/De-esser/ratio', label: 'Ratio', min: 1, max: 20, defaultValue: 4, step: 0.5, type: 'hslider' },
        { address: '/De-esser/listen', label: 'Listen (Solo SC)', min: 0, max: 1, defaultValue: 0, step: 1, type: 'checkbox' },
    ]);
}
