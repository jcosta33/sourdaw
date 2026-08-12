---
type: architecture-decision-record
status: accepted
date: 2026-08-12
---

# 0023 — Allpass fractional delay in the Karplus-Strong loop, offset off zero

**Accepted 2026-08-12.** Resolved from primary sources under the owner's standing direction that decision gates are research tasks. resolves the interpolation half of
`CHANGE-fermenter-core-and-shipped-engine-conformance` DG-003.

## Context

`crates/daw-dsp/src/fermenter/physical.rs:68-72` interpolates the delay line linearly:

```rust
buffer[read0] * (1.0 - frac) + buffer[read1] * frac
```

The loop gain is deliberately near unity — `coeff = 1.0 - self.damping * 0.5` — which is exactly the
condition under which linear interpolation's amplitude error becomes audible.

## What the literature says, from the source

Jaffe & Smith, *Extensions of the Karplus-Strong Plucked String Algorithm*, CMJ 7(2), 1983, introduced
the tuning allpass for this problem. Their statement of it, p. 59–60:

> "The fact that the delay-line length N must be an integer causes tuning problems. Since the
> fundamental frequency is f₁ = f_s/(N + 1/2), the allowed pitches are quantized, especially at high
> frequency."

> "we need to introduce into the feedback loop a filter that can contribute a small delay without
> altering the loop gain."

> "The filter H_c is a first-order *allpass* filter, and as such it has a constant amplitude response.
> … The use of an allpass filter ensures that no modification of the decay rate will take place."

The filter, Eq. (12) and its transfer function:

```
y_n = C·x_n + x_{n-1} − C·y_{n−1}        H_c(z) = (C + z⁻¹)/(1 + C z⁻¹)
```

with the low-frequency coefficient approximation `C ≈ (1 − P_c)/(1 + P_c)` (Eq. 17).

**The range constraint is the load-bearing detail**, p. 61:

> "A delay of 0 samples corresponds to C = 1, where the pole and zero of H_c(z) cancel… pole-zero
> cancellation on the unit circle is not a good thing in practice, since round-off errors may yield an
> unstable filter. Therefore, it is preferable to shift the range of one-sample delay control to the
> region ε ≤ P_c ≤ (1 + ε)… It is best not to shift very far, since the phase-delay curves are less
> flat in the region beyond one sample's delay."

Smith's *Physical Audio Signal Processing* makes that concrete: `Δ∈[0.1,1.1] ⟷ η∈[−0.05,0.82]`, and
for the Extended Karplus-Strong specifically, `η ∈ [−1/11, 2/3]` for delays in `[0.2, 1.2]`.

## Decision

**Replace linear interpolation with a first-order allpass, with the fractional delay constrained to
`Δ ∈ [0.1, 1.1]`.**

Version-gate it. The change is audible in a specific direction: the fractional-delay error currently
damps the loop, so removing it makes existing patches **ring longer**. That is a re-render of saved
work, and ADR 0017 already established that silently re-mixing existing projects is not acceptable.

## Correcting an earlier reading

I previously recorded that the allpass's transient behaviour meant "anyone adding glide to this
engine must revisit this decision." **That is wrong, and the primary sources say the opposite.**

The paper endorses coefficient ramping as the mechanism for smooth pitch change (p. 65):

> "A perfectly smooth glissando can be created by ramping C, the tuning coefficient, during the time
> between buffer-length changes. This technique can also be used to create vibrato."

Smith's PhD thesis (Stanford CCRMA STAN-M-14, 1983, §3.13.3) is stronger — integer delay is what
fails for vibrato, not the allpass:

> "Since the delay lines are of integer length, unacceptable results are obtained unless an
> interpolation of delay length is performed. It was found that the technique presented in §3.11.1 can
> be easily adapted to provide vibrato with no audible distortion due to string quantization."

The real transient constraint is about **small delay**, not changing delay: PASP notes the transient
response lengthens "as Δ→0… when the pole at z=−η gets close to the unit circle," which is precisely
why the range is offset off zero. Honouring `Δ ∈ [0.1, 1.1]` addresses it.

Two genuine caveats do apply. Allpass interpolation "is not suitable for 'random access'
interpolation… because the allpass is recursive so that it must run for enough samples to reach
steady state" — fine for a loop that runs continuously. And for *large* delay changes, PASP
recommends cross-fading between configurations with the new filter "warmed up (executed) for N time
steps before beginning the cross-fade," which also avoids an unwanted Doppler sweep.

## On industry precedent: there is none to defer to

**No shipping physical-modelling product documents which fractional-delay interpolation it uses.**
Ableton Tension, AAS String Studio VS-3 and Chromaphone, Pianoteq and Physical Audio all describe
their engines at the "solves equations" level and never mention delay lines, interpolation, or
allpass filters. Madrona Labs' Kaivo is the one vendor that makes an engine claim, and it is that
they avoid waveguides entirely in favour of FDTD.

So this decision rests on the literature rather than on convention, which is the right authority for a
question the industry does not publish answers to.

## Sources

- Jaffe & Smith, CMJ 7(2):56-69, 1983 — http://musicweb.ucsd.edu/~trsmyth/papers/KSExtensions.pdf (DOI 10.2307/3680063)
- J. O. Smith III, Stanford CCRMA STAN-M-14, 1983 — https://ccrma.stanford.edu/STANM/stanms/stanm14/stanm14.pdf
- *Physical Audio Signal Processing*: https://ccrma.stanford.edu/~jos/pasp/First_Order_Allpass_Interpolation.html · .../Extended_Karplus_Strong_Algorithm.html · .../Minimizing_First_Order_Allpass_Transient.html · .../Large_Delay_Changes.html

**Unverified:** Välimäki, Laakso & Mackenzie, "Elimination of transients in time-varying allpass
fractional delay filters" (ICMC'95) is the canonical reference for coefficient-change transients; only
its citation is sourced here, not its contents. If dynamic pitch modulation is added later, read it
first.
