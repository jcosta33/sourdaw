import("stdfaust.lib");
gain = hslider("gain", 0, -36, 36, 0.1) : ba.db2linear;
// `checkbox(...) : ba.if(-1, 1)` bound the checkbox to `ba.if`'s *last*
// argument, not its condition, so the constant condition folded the checkbox
// out of the compiled node entirely: `/Gain_Utility/invert_phase` resolved
// against nothing and the control was dead (#2300). select2 takes the
// condition first and leaves no room for that.
invert = select2(checkbox("invert_phase"), 1, -1);
width = hslider("width", 1, 0, 2, 0.01);
width_ctrl(L,R) = mid + side*width, mid - side*width
with { mid = (L+R)*0.5; side = (L-R)*0.5; };
process = _,_ : *(gain) * invert, *(gain) * invert : width_ctrl;