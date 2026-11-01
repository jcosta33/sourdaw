# Standing probes: recording session ownership

Defects where a recording session's first frame, ring publication, stop fence or artifact identity is decided by a
signal that does not prove the captured audio: worker readiness, a cursor check, an acknowledgment or the wall clock.
Split out of `session-lifecycle.md`.
Each probe names the failure mode, the input or state to drive and the check that must go red, and names the
mutation that must fail it where its source lesson established one. Controlled ports (media, graph, scheduler,
wall-clock) prove ordering, ownership and cleanup; they never establish physical hardware audibility.

## Standing probes

1. **Worker-ready recording admission reaches the real first-frame seam.** Capture started from a worker-ready
   continuation while the command already returned success before the worklet captured input. Hold worker readiness
   through the real recorder-to-transport route and drive the first nonempty processor block at a known
   `AudioWorkletGlobalScope.currentFrame`. No successful-start observable and no uncaptured transport interval may
   exist before the actual sample-zero receipt, and exactly one start follows it. A returned boolean, the
   worker-ready message, main-thread callback time or a pre-resolved recorder mock cannot establish capture-clock
   alignment; resolving the start on worker readiness must fail the case.

## Recording rings, stop fence and artifact identity

Moved from the `web-audio-engine` skill. A pre-copy cursor check can admit mixed PCM, a signed or low-word rollover
can make a full ring turn look empty, and clearing the stop deadline on the producer acknowledgment lets a stalled
final drain retain the input session indefinitely.

2. **Ring publication.** Drive real 128-frame writes across signed and unsigned word rollover, at capacity minus
   one, exact and plus one, and with a writer paused inside the consumer copy. The worker copies only an interval
   bracketed by the same stable sequence and cumulative count, retries an in-progress or changed copy, and abandons a
   lapped interval rather than write substituted PCM. Publishing a signed 32-bit cursor as the history contract, or
   the count before the odd sequence, must fail a case.
3. **Stop fence.** Accept only the captured session's producer-stop acknowledgment, make one final worker drain
   against that count, and keep the original flush deadline armed through acknowledgment. A missing acknowledgment or
   flush cleans that exact captured session without touching a successor for the same track; clearing the deadline
   on acknowledgment must fail.
4. **Artifact identity.** Recording artifacts need identity independent of wall-clock time: one cryptographically
   unique temp-file name generated at worker initialization. Run two isolated workers sharing a filename-keyed
   staged OPFS at one timestamp: each delivered WAV retains its own PCM, and removing one staging entry does not
   remove the other's.
