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

# Isolated state + demo mode so the recording is reproducible and never
# touches the real ~/.repogarden. tape/setup.sh seeds eight empty git
# repos under $DEMO_HOME/garden and stages a launcher script.
Env HOME "/tmp/repogarden-demo-home"
Env REPOGARDEN_DEMO "1"

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

# Onboarding pre-fills the input with "~/repos" — setup.sh seeded eight
# git repos there, so a single Enter starts the scan.
Enter
Sleep 3500ms

# Initial garden — quick beat so the swarm is established before we
# switch to the view that actually explains them.
Down
Sleep 600ms
Down
Sleep 800ms

# Shelf is where the four vibe groups (awake / happy / stuck / sleepy)
# read as distinct labelled rows. Dwell long enough for a viewer to
# clock all four group headers.
Type "g"
Sleep 5s

# Walk down a few creatures so the focus card cycles through different
# vibes — colour + glyph in the card change with each step.
Down
Sleep 700ms
Down
Sleep 700ms
Down
Sleep 1200ms

# Workbench peek — one creature opened so the GIF shows the per-repo
# detail mode (portrait, notes, recent commits) before we return.
Enter
Sleep 3500ms
Escape
Sleep 1000ms

# Journal pass so the third view is visible.
Type "g"
Sleep 2500ms

# Back to garden to finish on the swarm.
Type "g"
Sleep 2s

# End on the garden so the loop restarts cleanly from boot. No explicit
# quit — the recording ends here and vhs closes the process.
