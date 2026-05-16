# Live TUI Observation Harness

Use this when you need to inspect the real Ink app while it is running: focus,
selection, active hints, and especially idle Garden behavior while the app sits
untouched.

Use [`snapshot.sh`](../../snapshot.sh) only for one-shot layout checks. It is
fast, but it does not give a trustworthy read on live focus state or
mid-animation frames.

## What the harness does

`scripts/tui-observe.sh` runs the real `pnpm dev` app inside a detached
`tmux` session with:

- fixed terminal size (`100x32` by default)
- disposable `HOME`
- `REPOGARDEN_DISABLE_USAGE=1`
- `~/repos/root` symlinked to a chosen root; first-run onboarding is filled
  with `~/repos/root` and submitted automatically

The harness then reads the current visible terminal surface with
`tmux capture-pane`, which avoids the noisy ANSI stream you get from raw PTY
logging.

## Basic flow

From the repo root:

```bash
pnpm observe:tui -- start
pnpm observe:tui -- capture garden-baseline
pnpm observe:tui -- sample 5 400 idle-garden
pnpm observe:tui -- flicker 8 150 idle-garden
pnpm observe:tui -- stop
```

The leading `--` is optional when calling the script directly:

```bash
./scripts/tui-observe.sh start
./scripts/tui-observe.sh capture garden-baseline
./scripts/tui-observe.sh stop
```

You can also point the harness at another scan root:

```bash
pnpm observe:tui -- start /path/to/repos
```

## Supported commands

```bash
scripts/tui-observe.sh start [root]
scripts/tui-observe.sh send <keys...>
scripts/tui-observe.sh wait <ms>
scripts/tui-observe.sh capture [label]
scripts/tui-observe.sh sample <count> <interval-ms> [label-prefix]
scripts/tui-observe.sh flicker <count> <interval-ms> [label-prefix]
scripts/tui-observe.sh stop
```

Supported keys in `send` cover the main top-level debug loop:

- `g`, `j`, `k`
- `Enter`, `Escape`
- `Up`, `Down`
- `h`, `o`, `p`, `q`, `r`, `s`, `t`, `f`, `d`, `c`, `/`, `?`

## Reading active states

For settled state, capture immediately after a keypress plus a short wait:

```bash
pnpm observe:tui -- send Down
pnpm observe:tui -- wait 150
pnpm observe:tui -- capture focused-second-creature
```

This is the main way to confirm:

- which repo is focused
- which help hint row is active
- whether the sidebar cursor moved
- whether journal selection changed

## Sampling idle Garden mode

For idle Garden behavior, do not send any keys after startup. Sample the live
screen repeatedly:

```bash
pnpm observe:tui -- start
pnpm observe:tui -- capture garden-baseline
pnpm observe:tui -- sample 6 300 idle-garden
```

This is the main workflow for checking:

- whether sprites drift or jitter while idle
- whether the focus card changes unexpectedly
- whether stars or other background cells repaint incorrectly
- whether the visible screen stabilizes or keeps mutating

Use shorter intervals (`100`-`250ms`) for fast jitter, and longer intervals
(`400`-`1000ms`) for slower creature drift.

## Locating flicker hotspots

When the screen is supposed to be visually stable, use `flicker` instead of
raw `sample`:

```bash
pnpm observe:tui -- start
pnpm observe:tui -- flicker 8 150 idle-garden
```

This captures repeated live frames and prints a report with:

- how many sample-to-sample transitions changed at all
- the exact row/column bounds of the busiest change regions
- the first changed cell for each unstable transition

Use it after startup settles, or during a targeted repro, to answer "where on
screen is still repainting?" before you start guessing at the component.

## Sampling transitions

Transitions still work the old way when needed:

```bash
pnpm observe:tui -- send g
pnpm observe:tui -- wait 250
pnpm observe:tui -- capture journal-early
pnpm observe:tui -- wait 900
pnpm observe:tui -- capture journal-late
pnpm observe:tui -- wait 600
pnpm observe:tui -- capture journal-settled
```

## Notes

- `capture [label]` prints the current visible screen to stdout and also saves
  a text artifact under the harness temp session directory while the session is
  active
- `sample` runs repeated labeled captures, saving each one so you can compare
  untouched idle frames
- `stop` kills the `tmux` session and removes the disposable `HOME`
- If the harness gets out of sync, run `scripts/tui-observe.sh stop` and start
  fresh
