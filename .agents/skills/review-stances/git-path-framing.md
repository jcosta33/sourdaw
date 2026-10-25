# Lesson library: Git path framing at destructive boundaries

## 2026-10-25 — quoted ignored paths bypassed protected agent state (#5655)

PR [#1802](https://github.com/jcosta33/sourdaw/pull/1802), commit `d3cfd6f01d`, made `lane:remove` reject non-disposable ignored files but read `git ls-files --ignored --directory` by splitting lines. Git C-quotes a pathname containing a line feed: the returned record starts with a quote and contains a literal `\n` sequence. The `.agents/` protection added by #5655 did not recognize that record as agent state, while its `/dist/` component still matched the generic disposable rule. `lane:remove` and `lane:strand` could then admit deletion of that protected ignored file. PR [#2954](https://github.com/jcosta33/sourdaw/pull/2954) used NUL-framed paths in `lane:prune` but retained the removal reader unchanged. The public #1802 review comments demanded an ignored-data refusal and a real-worktree test; the published material does not establish the historical private stance prompt. The missed probe was Git output framing across all cleanup consumers, including the later strand route.

For every Git-derived pathname that can authorize deletion, use `-z` and split on NUL before classification. In a real disposable Git fixture, ignore `.agents/records<literal line feed>/dist/receipt.json`, leave a sibling unignored so Git reports the file, and also ignore an ordinary `node_modules/` directory. Feed the actual ignored adapter to `removeLane` and `strandLane` with fake mutation ports: both must refuse before unlock, worktree removal, receipt write, or branch deletion, while the ordinary directory remains admitted. Check the `lane:prune` reader and its deletion selector against the same pathname class. Replacing NUL framing with line splitting must make the refusal tests fail.

## 2026-10-25 — raw NUL output was trimmed before path splitting (#5655 repair review)

The first #5655 repair added `-z` to the removal reader, but both removal and pruning shell captures still called `stdout.trim()`. With a first ignored record named `<literal line feed>dist/receipt.json`, trimming dropped the leading byte and produced the different, disposable path `dist/receipt.json`. The remove and strand gates admitted it; pruning selected the wrong path and removed a tracked sentinel there in a disposable Git fixture. NUL framing alone is insufficient when a generic capture transforms stdout before the split.

Use an explicit raw-stdout capture option for Git pathname streams while leaving non-path command output trimming and error handling intact. Plant the leading-line-feed ignored file with a tracked sibling so Git reports its exact path, plus a tracked `dist/receipt.json` sentinel and an ignored `node_modules/` control. Require remove and strand refusal before every destructive effect; require prune to select only `node_modules/` and preserve both protected data and the sentinel. Changing either pathname reader back to trimmed stdout must fail the corresponding real-Git test.

## 2026-10-25 — literal backslash was reinterpreted as a Git path separator (#5655)

PR #5655 preserved raw NUL-delimited Git pathnames at cleanup admission, but its shared
`disposableIgnored` classifier replaced each backslash with `/`. Git's `-z` contract emits the
pathname verbatim; on POSIX, a backslash is a valid filename character, not a directory separator.
An ignored regular file literally named `node_modules\\receipt.json` therefore passed the
disposable `node_modules/` component rule. Removal and stranding admitted deletion, and pruning
deleted the literal ignored leaf.

Treat Git pathname components as opaque and split only on the slash Git emits. Do not convert
backslashes before applying disposable rules. Keep direct cases for backslash-only lookalikes and
slash-delimited controls, plus a real Git fixture containing the literal backslash leaf: removal
and stranding must refuse before mutation, and pruning must preserve the file. The baseline missed
stance was Git pathname component framing: it checked NUL framing and stdout preservation but did
not attack whether classification changed the raw pathname's component boundaries.
