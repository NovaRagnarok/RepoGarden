# RepoGarden demo
# Regenerate from repo root with:  vhs tape/demo.tape
# Requires: vhs, ttyd >= 1.7.4, ffmpeg

Output docs/images/demo.gif

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 720
Set Padding 16
Set TypingSpeed 55ms

# Isolated state so the recording is reproducible and never touches the
# real ~/.repogarden. tape/setup.sh stages a launcher script plus a
# tui.json that turns pagination off and density to dense, so the demo
# roster's 32 creatures land on a single screen instead of paging.
Env HOME "/tmp/repogarden-demo-home"

Hide
Type "tape/setup.sh > /dev/null"
Enter
Sleep 800ms
Type "cd ~ && clear"
Enter
Sleep 200ms
Show

Type "./launch"
Enter
Sleep 3500ms

# First-launch onboarding shows the empty-state affordances. `d` seeds
# the synthetic demo roster (32 creatures, four vibes, varied sprite
# sizes via DEMO_SIZE_ARCHETYPES) and flips privacy to demo mode in one
# keystroke — far more populated than scanning the 8 stub repos.
#
# 6s settle: the cross-fade to garden (TRANSITION_MS = 1400ms) plus the
# direct-stdout sprite painter need a full beat to populate the canvas;
# at 4s the captured frame caught a half-painted garden with no
# creatures visible (manual-qa-report on the prior demo recording).
Type "d"
Sleep 6s

Down
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 1s

# View cycle is garden → shelf → journal, then we stop. The cross-fade /
# placement tween (TRANSITION_MS in ReadyShell.tsx) is 1400ms, so any
# sleep after `g` needs to comfortably exceed that to leave a settled
# view on screen long enough to read.
#
# We deliberately do NOT cycle journal → garden in the recording: the
# garden's direct-stdout sprite painter doesn't repaint after the
# journal→garden cross-fade (engine destroys on cross-fade, remount
# doesn't trigger a paint), leaving an empty canvas for the last ~2s
# of the loop. Ending on journal lets the GIF loop back to the boot
# screen instead, which the user reads as a natural restart.
Type "g"
Sleep 3500ms

Type "g"
Sleep 4500ms
