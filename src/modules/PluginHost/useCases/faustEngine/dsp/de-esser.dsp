import("stdfaust.lib");
freq = hslider("frequency", 6000, 2000, 12000, 10);
bw = hslider("bandwidth", 2.0, 0.5, 6.0, 0.1);
thresh = hslider("threshold", -15, -60, 0, 0.5);
ratio = hslider("ratio", 4, 1, 20, 0.5);
// Maximum gain reduction, the "range" control every shipping de-esser carries
// (Waves DeEsser, FabFilter Pro-DS). The device catalog has declared it since
// the descriptor was written and this file had no such control, so the knob
// moved and changed nothing (#2300). At 0 dB the de-esser is off, which is what
// a range control means.
reduction = hslider("reduction", 6, 0, 20, 0.5);
atk = 0.001; rel = 0.05;
listen = checkbox("listen");
sc_signal = fi.resonbp(freq, bw, 1);
// Attack/release envelope: fast attack-smoothed level, kept high by the
// slow release-smoothed level (the original max composition dropped a bus —
// an arity error).
attack_env = sc_signal : abs : si.smooth(ba.tau2pole(atk));
env(x) = max(attack_env(x), attack_env(x) : si.smooth(ba.tau2pole(rel)));
gr(e) = ba.if(e > ba.db2linear(thresh), max(ba.db2linear(0 - reduction), ratio_gain(e)), 1.0)
with { ratio_gain(level) = pow(ba.db2linear(thresh) / level, 1 - 1.0/ratio); };
// listen=1 monitors the sidechain; otherwise output is gain * dry.
deess(x) = select2(listen, (x : env : gr) * x, x : sc_signal);
process = deess, deess;
