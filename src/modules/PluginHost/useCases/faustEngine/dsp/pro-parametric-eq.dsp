import("stdfaust.lib");
process = vgroup("eq", 
    fi.low_shelf(lf_gain, lf_freq) :
    fi.peak_eq_cq(mf_gain, mf_freq, mf_q) :
    fi.high_shelf(hf_gain, hf_freq)
) with {
    lf_gain = hslider("lf_gain", 0, -18, 18, 0.1);
    lf_freq = hslider("lf_freq", 100, 20, 500, 1);
    mf_gain = hslider("mf_gain", 0, -18, 18, 0.1);
    mf_freq = hslider("mf_freq", 1000, 200, 8000, 1);
    mf_q = hslider("mf_q", 1, 0.1, 10, 0.1);
    hf_gain = hslider("hf_gain", 0, -18, 18, 0.1);
    hf_freq = hslider("hf_freq", 8000, 1000, 20000, 100);
};
