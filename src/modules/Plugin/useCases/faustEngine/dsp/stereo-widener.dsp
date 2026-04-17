import("stdfaust.lib");
width = hslider("width", 100, 0, 200, 1) / 100.0;
mono_freq = hslider("mono_bass", 0, 0, 500, 1);
mid(l, r) = (l + r) * 0.5;
side(l, r) = (l - r) * 0.5;
bass_mono(m, s) = m, (s * ba.if(mono_freq > 1, 1.0 - (fi.lowpass(1, mono_freq) : abs : si.smooth(0.999)), 1.0));
process(l, r) = mid(l,r), side(l,r) : bass_mono : (*(1.0), *(width)) : (+(_, _), -(_, _));