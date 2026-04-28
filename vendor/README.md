# Vendored Libraries

These libraries are bundled directly into the extension because the project has no bundler.

## finder.js

- Source: https://github.com/antonmedv/finder
- Version: 3.2.0
- License: MIT
- Purpose: Generate unique, robust CSS selectors for arbitrary DOM elements.
  Used by the Inspect-for-AI feature to capture stable selectors when the user
  alt-clicks an element.
- Global: `window.JTFinder(element, options?)`

## css-tree.js

- Source: https://github.com/csstree/csstree
- Version: 2.3.1
- License: MIT
- Purpose: Parse CSS into a serializable AST and walk/transform it. Used by
  the tweak engine's CSS sanitizer to reject dangerous rules and auto-scope
  every tweak's selectors to a `.jt-tweak-{id}` wrapper.
- Global: `window.csstree`
