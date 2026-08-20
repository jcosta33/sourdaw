import("stdfaust.lib");
pre_a0 = 1.53512485958697; pre_a1 = -2.69169618940638;
pre_a2 = 1.19839281085285; pre_b1 = -1.69065929318241; pre_b2 = 0.73248077421585;
rlb_a0 = 1.0; rlb_a1 = -2.0; rlb_a2 = 1.0; rlb_b1 = -1.99004745483398; rlb_b2 = 0.99007225036621;
kweight = fi.tf22t(pre_a0, pre_a1, pre_a2, pre_b1, pre_b2) : fi.tf22t(rlb_a0, rlb_a1, rlb_a2, rlb_b1, rlb_b2);
ms_window(t) = ^(2) : si.smooth(ba.tau2pole(t));
lufs(ms) = ba.if(ms > 1e-10, 10 * log10(ms) - 0.691, -70);
// BS.1770 loudness is one figure for the programme: the K-weighted mean
// squares of the channels are summed (G = 1.0 for L and R), then converted.
// Metering each channel separately produced two parameters called "momentary"
// and two called "short_term"; faustDeviceFactory keys parameters by their
// last path segment and keeps the first of a collision, so the readings the
// app could reach were the left channel's alone — about 3 dB under the true
// programme loudness on correlated material (#2300).
momentary_ms(l, r) = (l : kweight : ms_window(0.4)) + (r : kweight : ms_window(0.4));
shortterm_ms(l, r) = (l : kweight : ms_window(3.0)) + (r : kweight : ms_window(3.0));
process(l, r) =
    attach(l, momentary_ms(l, r) : lufs : vbargraph("momentary", -70, 0)),
    attach(r, shortterm_ms(l, r) : lufs : vbargraph("short_term", -70, 0));