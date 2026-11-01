# Standing probes: trusted scripts and delivery

Defects where a trusted script or delivery route is exercised through a substitute path, or validated on a tree other
than the one that merges. Split out of `correctness.md`; a stance matching this class carries this file instead of it.
Each probe names the failure mode, the input, state or mutation to run, and the check that must go red.
Report the concrete break or none.

## Standing probes

1. **Invoke the real route with default dependencies.** Trace a new capability from the package
   command through the protected launcher to its consumer and run it with controlled remote ports and
   the default owner fence; observe the acquired process identity before the first PR read. Omitting
   the command from the launcher's fenced set, or restoring a direct package route to the transaction
   script, must fail before remote I/O; lock fixtures that inject owner fences cannot show it (#5639).
2. **Validated tree vs merged tree.** When the base tip moved after the head's last run, especially
   in the same file, require evidence covering base plus head; reverting either contributing hunk must fail that combined typecheck (#5243).
