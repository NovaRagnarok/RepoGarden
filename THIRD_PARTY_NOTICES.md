# Third-party notices

RepoGarden bundles and adapts code, themes, and interaction patterns from the
following projects.

## termcn

Source: <https://github.com/Aniket-508/termcn>
License: MIT

RepoGarden's terminal UI owes a substantial debt to termcn. In practice, it is
the main upstream source for our bundled theme set and several terminal UI
implementation patterns.

Adapted in:

- `src/components/ui/gradient.tsx` — vendored wholesale from `registry/bases/ink/ui/gradient.tsx`; API and presets are kept identical to upstream
- `src/components/ui/text-area.tsx` — scroll-viewport pattern lifted from termcn's `ScrollView` component
- `src/themes/*.ts` and `src/themes/index.ts` — theme palette definitions, naming, and the bundled theme catalogue are ported and normalized from termcn's theme registry for RepoGarden's theme shape

The list above is representative rather than exhaustive: beyond direct code and
palette ports, RepoGarden also borrows UI conventions and component behavior
from termcn's Ink-based design system.

© Aniket Kumar and contributors — see source repo for full notice.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
