# Nice KBDs

`<kbd>` is the HTML tag for keyboard input. It's useful for showing keyboard shortcuts in documentation. This plugin automatically adds the `<kbd>` tag to any text that matches the pattern of a keyboard shortcut.

This plugin assumes that keyboard shortcuts start with an identifiable key (e.g. 'Ctrl', '⌘', '⇧') and may contain following keys, potentially separated by a plus sign ('+'). E.g.:
- ⌘⇧A
- Ctrl+Shift+A
- ⌘ + ⌥ + F12

# 🎩

Credit to Ryota Ushio for answering my questions in [this feature request](https://forum.obsidian.md/t/plugin-api-expose-live-edit-functionality-for-extension/73447/7) and pointing me towards his plugin [Better Math in Callouts & Blockquotes](https://github.com/RyotaUshio/obsidian-math-in-callout/blob/master/src/decorations.ts) which I used to model the editor extension in this plugin.
