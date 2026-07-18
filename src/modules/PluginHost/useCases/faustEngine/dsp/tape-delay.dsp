import("stdfaust.lib");
process = ef.echo(maxdel, delay, feedback)
with {
    maxdel = 2.0;
    delay = hslider("delay", 0.3, 0.01, 2, 0.01);
    feedback = hslider("feedback", 0.5, 0, 0.95, 0.01);
};
