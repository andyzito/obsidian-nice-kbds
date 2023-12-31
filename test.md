#testing #⌘ #⌘⇧A #«z»«r»

# NiceKBDs Test

## Examples

**Basic combos:**
⌘
⌘A
⌘ + B
⌘ + CTRL + C
Ctrl + D

**With literals:**
«A»
«ABC»
«D😊E»
«F + G»
«⌘»
«⌘» + H
«H» + «I»

**Weirder stuff:**
⌘ + \`
«\\» + \<
«test» + \\

**Whitespace???**
⌘     +    a
Ctrl   +    b
   Ctrl +  z  +r

**Should NOT trigger a key combo:**
CtrlD

**Things that don't work quite right yet:**
Ctrl+ ⇧ + A

## Testing in context

### Shortcuts should appear (⌘ + A) in headings

### Even when there's weird stuff «test» + \\ + «H» + \`, yes

### And...

*Shortcuts should work in italics ⌘ + A, yes*, and in bold **⌘ + A, yes**, but not if you try to overlap them like this **⌘** + A -- nope.

Shortcuts should work in links like this [My Link Ctrl + «H» is here](https://obsidian.md). Escaped characters in links do not work in live edit mode, which is a limitation of Obsidian itself: [«Alt» + \\ + Q](https://obsidian.md). (But this should look fine in reading mode.)

[^ft]: I guess in footnotes («H» + \`) is fine?

Shortcuts should work in lists:
- «Alt» + \` + «F12»
  - «Ctrl» + \\ + A

1. Ctrl + Alt + \<
    2. «foo» + Cmd + «⌘»

Shortcuts should work in blockquotes like this:

> Press ⌘ + «B» to detonate.
> Press «CMD» + «OPT» + \< to cancel.

Shortcuts should also work in Callouts like this:

> [!NOTE] In the «⌘» + \` title of a callout,
> Or in the body «Cmd» + \\ + K...



Shortcuts should NOT work in code blocks like this:

```js
⌘ + A
«CMD» + «OPT» + \<
```

And nor should they work in inline code like this: `⌘ + A`,  `or like this: «CMD» + «OPT» + \<`

They should NOT work when ~~struck through «H» + \` like this~~.
