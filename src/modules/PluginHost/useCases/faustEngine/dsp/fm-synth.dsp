import("stdfaust.lib");
freq = hslider("freq", 440, 20, 10000, 0.1);
gain = hslider("gain", 0.5, 0, 1, 0.01);
gate = button("gate");
algo = hslider("algorithm", 0, 0, 3, 1);

// OP1 (Carrier)
r1 = hslider("op1_ratio", 1, 0.5, 16, 0.01);
l1 = hslider("op1_level", 1, 0, 1, 0.01);
a1 = hslider("op1_attack", 0.01, 0.001, 5, 0.001);
d1 = hslider("op1_decay", 0.1, 0.01, 5, 0.01);
s1 = hslider("op1_sustain", 0.8, 0, 1, 0.01);
rel1 = hslider("op1_release", 0.5, 0.01, 10, 0.01);
env1 = en.adsr(a1, d1, s1, rel1, gate);

// OP2
r2 = hslider("op2_ratio", 2, 0.5, 16, 0.01);
l2 = hslider("op2_level", 0.5, 0, 1, 0.01);
a2 = hslider("op2_attack", 0.01, 0.001, 5, 0.001);
d2 = hslider("op2_decay", 0.1, 0.01, 5, 0.01);
s2 = hslider("op2_sustain", 0.8, 0, 1, 0.01);
rel2 = hslider("op2_release", 0.5, 0.01, 10, 0.01);
env2 = en.adsr(a2, d2, s2, rel2, gate);

// OP3
r3 = hslider("op3_ratio", 3, 0.5, 16, 0.01);
l3 = hslider("op3_level", 0.5, 0, 1, 0.01);
a3 = hslider("op3_attack", 0.01, 0.001, 5, 0.001);
d3 = hslider("op3_decay", 0.1, 0.01, 5, 0.01);
s3 = hslider("op3_sustain", 0.8, 0, 1, 0.01);
rel3 = hslider("op3_release", 0.5, 0.01, 10, 0.01);
env3 = en.adsr(a3, d3, s3, rel3, gate);

// OP4
r4 = hslider("op4_ratio", 4, 0.5, 16, 0.01);
l4 = hslider("op4_level", 0.5, 0, 1, 0.01);
a4 = hslider("op4_attack", 0.01, 0.001, 5, 0.001);
d4 = hslider("op4_decay", 0.1, 0.01, 5, 0.01);
s4 = hslider("op4_sustain", 0.8, 0, 1, 0.01);
rel4 = hslider("op4_release", 0.5, 0.01, 10, 0.01);
env4 = en.adsr(a4, d4, s4, rel4, gate);

f1 = freq * r1;
f2 = freq * r2;
f3 = freq * r3;
f4 = freq * r4;

// Algorithms
// 0: 4->3->2->1 (Cascade)
op4_0 = os.osc(f4) * f4 * l4 * env4;
op3_0 = os.osc(f3 + op4_0) * f3 * l3 * env3;
op2_0 = os.osc(f2 + op3_0) * f2 * l2 * env2;
op1_0 = os.osc(f1 + op2_0) * l1 * env1;

// 1: (4+3)->2->1
op4_1 = os.osc(f4) * f4 * l4 * env4;
op3_1 = os.osc(f3) * f3 * l3 * env3;
op2_1 = os.osc(f2 + op4_1 + op3_1) * f2 * l2 * env2;
op1_1 = os.osc(f1 + op2_1) * l1 * env1;

// 2: (4->3) + 2 -> 1
op4_2 = os.osc(f4) * f4 * l4 * env4;
op3_2 = os.osc(f3 + op4_2) * f3 * l3 * env3;
op2_2 = os.osc(f2) * f2 * l2 * env2;
op1_2 = os.osc(f1 + op3_2 + op2_2) * l1 * env1;

// 3: 4->3, 2->1 (Parallel carriers)
op4_3 = os.osc(f4) * f4 * l4 * env4;
op3_3 = os.osc(f3 + op4_3) * l3 * env3;
op2_3 = os.osc(f2) * f2 * l2 * env2;
op1_3 = os.osc(f1 + op2_3) * l1 * env1;

out = ba.selectn(4, algo, op1_0, op1_1, op1_2, (op1_3 + op3_3) * 0.5);
process = out * gain <: _, _;