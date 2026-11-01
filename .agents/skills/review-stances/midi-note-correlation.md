# Standing probes: MIDI note correlation and expression ordering

Defects where a MIDI transform pairs a Note Off or expression with the wrong note instance. Split out of
`correctness.md`; a stance matching this class carries this file instead of it.
Each probe names the failure mode, the input, state or mutation to run, and the check that must go red.
Report the concrete break or none.

## Standing probes

1. **Note-correlation regressions cross the rack boundary.** When a transform stores a Note On decision
   for a later Note Off, drive supplied `noteInstanceId` values through `MidiRack`: one equal-pitch note,
   change the deciding parameter while held, then attack and release a second identity first. Assert
   emitted identity and pitch or suppression; channel/pitch FIFO must fail. Keep identityless FIFO apart.
2. **Expression ordering around note release.** Hold the note-on's async worker, admit pressure, CC74,
   bend, release and the next same-channel note; read the curve points and execution order; an idle
   unrelated channel stays immediate (#805).
