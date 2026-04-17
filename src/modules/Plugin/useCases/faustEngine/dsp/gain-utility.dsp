import("stdfaust.lib");
gain = hslider("gain", 0, -36, 36, 0.1) : ba.db2linear;
invert = checkbox("invert_phase") : ba.if(-1, 1);
width = hslider("width", 1, 0, 2, 0.01);
width_ctrl(L,R) = mid + side*width, mid - side*width
with { mid = (L+R)*0.5; side = (L-R)*0.5; };
process = _,_ : *(gain) * invert, *(gain) * invert : width_ctrl;