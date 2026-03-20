/**
 * Pro Modulation Effects (Faust-based).
 * DSP definitions for professional modulation effects.
 */

import { registerFaustDSP } from './faustEngine';

/**
 * Register all pro modulation effects.
 */
export function registerProModulationEffects(): void {
    // Multi-voice chorus
    registerFaustDSP('Multi-Voice Chorus', `
        import("stdfaust.lib");
        voices = 4;
        process = par(i, voices,
            de.fdelay(maxdel, del(i)) * (1/voices)
        ) :> _, _
        with {
            maxdel = 4096;
            rate = hslider("rate", 1, 0.1, 5, 0.01);
            depth = hslider("depth", 0.5, 0, 1, 0.01);
            del(i) = maxdel/2 * (1 + depth * os.osc(rate * (1 + i * 0.1)));
        };
    `, [
        { address: '/chorus/rate', label: 'Rate', min: 0.1, max: 5, defaultValue: 1, step: 0.01, type: 'hslider' },
        { address: '/chorus/depth', label: 'Depth', min: 0, max: 1, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        { address: '/chorus/voices', label: 'Voices', min: 2, max: 8, defaultValue: 4, step: 1, type: 'nentry' },
        { address: '/chorus/mix', label: 'Mix', min: 0, max: 1, defaultValue: 0.5, step: 0.01, type: 'hslider' },
    ]);

    // Through-zero flanger
    registerFaustDSP('Through-Zero Flanger', `
        import("stdfaust.lib");
        process = pf.flanger_stereo(dmax, delay1, delay2, depth, fb, invert)
        with {
            dmax = 2048;
            rate = hslider("rate", 0.5, 0.01, 3, 0.01);
            delay1 = dmax/2 * (1 + os.osc(rate));
            delay2 = dmax/2 * (1 + os.osc(rate + 0.01));
            depth = hslider("depth", 0.7, 0, 1, 0.01);
            fb = hslider("feedback", 0.6, -0.99, 0.99, 0.01);
            invert = checkbox("invert");
        };
    `, [
        { address: '/flanger/rate', label: 'Rate', min: 0.01, max: 3, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        { address: '/flanger/depth', label: 'Depth', min: 0, max: 1, defaultValue: 0.7, step: 0.01, type: 'hslider' },
        { address: '/flanger/feedback', label: 'Feedback', min: -0.99, max: 0.99, defaultValue: 0.6, step: 0.01, type: 'hslider' },
        { address: '/flanger/invert', label: 'Invert', min: 0, max: 1, defaultValue: 0, step: 1, type: 'checkbox' },
    ]);

    // Multi-stage phaser
    registerFaustDSP('Phaser', `
        import("stdfaust.lib");
        process = pf.phaser2_stereo(Notches, width, frqmin, fratio, frqmax, speed, depth, fb, invert)
        with {
            Notches = 6;
            width = hslider("width", 1000, 100, 5000, 1);
            frqmin = hslider("min_freq", 100, 20, 1000, 1);
            fratio = hslider("ratio", 1.5, 1, 3, 0.01);
            frqmax = hslider("max_freq", 800, 200, 10000, 1);
            speed = hslider("speed", 0.5, 0.01, 5, 0.01);
            depth = hslider("depth", 1, 0, 1, 0.01);
            fb = hslider("feedback", 0.5, 0, 0.99, 0.01);
            invert = 0;
        };
    `, [
        { address: '/phaser/speed', label: 'Speed', min: 0.01, max: 5, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        { address: '/phaser/depth', label: 'Depth', min: 0, max: 1, defaultValue: 1, step: 0.01, type: 'hslider' },
        { address: '/phaser/feedback', label: 'Feedback', min: 0, max: 0.99, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        { address: '/phaser/stages', label: 'Stages', min: 4, max: 12, defaultValue: 6, step: 2, type: 'nentry' },
    ]);

    // Tempo-synced tremolo
    registerFaustDSP('Tremolo', `
        import("stdfaust.lib");
        process = _ * (1 - depth * (1 + os.osc(rate)) / 2), _ * (1 - depth * (1 + os.osc(rate + phase_offset)) / 2)
        with {
            rate = hslider("rate", 4, 0.5, 20, 0.1);
            depth = hslider("depth", 0.5, 0, 1, 0.01);
            phase_offset = hslider("stereo_phase", 0, 0, 3.14159, 0.01);
        };
    `, [
        { address: '/tremolo/rate', label: 'Rate (Hz)', min: 0.5, max: 20, defaultValue: 4, step: 0.1, type: 'hslider' },
        { address: '/tremolo/depth', label: 'Depth', min: 0, max: 1, defaultValue: 0.5, step: 0.01, type: 'hslider' },
        { address: '/tremolo/stereo_phase', label: 'Stereo Phase', min: 0, max: 3.14, defaultValue: 0, step: 0.01, type: 'hslider' },
    ]);

    // Auto-pan
    registerFaustDSP('Auto-Pan', `
        import("stdfaust.lib");
        rate = hslider("rate", 1, 0.1, 10, 0.01);
        depth = hslider("depth", 1, 0, 1, 0.01);
        shape = hslider("shape", 0, 0, 1, 0.01); // 0=sine 1=triangle
        pan = depth * os.osc(rate);
        process = _ * (0.5 + 0.5 * pan), _ * (0.5 - 0.5 * pan);
    `, [
        { address: '/auto_pan/rate', label: 'Rate', min: 0.1, max: 10, defaultValue: 1, step: 0.01, type: 'hslider' },
        { address: '/auto_pan/depth', label: 'Depth', min: 0, max: 1, defaultValue: 1, step: 0.01, type: 'hslider' },
        { address: '/auto_pan/shape', label: 'Shape', min: 0, max: 1, defaultValue: 0, step: 0.01, type: 'hslider' },
    ]);
}
