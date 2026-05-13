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

Down
Sleep 500ms
Down
Sleep 500ms
Down
Sleep 800ms

Type "g"
Sleep 2500ms

Type "g"
Sleep 2500ms

Type "g"
Sleep 2s

# End on the garden so the loop restarts cleanly from boot. No explicit
# quit — the recording ends here and vhs closes the process.
