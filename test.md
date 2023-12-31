#testing #⌘ #⌘⇧A #«z»«r»

# NiceKBDs Test

## Examples

Basic combos:
- ⌘
- ⌘A
- ⌘ + B
- ⌘ + CTRL + C
- Ctrl + D

With literals:
- «A»
- «ABC»
- «D😊E»
- «F + G»
- «⌘»
- «⌘» + H
- «H» + «I»

Weirder stuff:
- ⌘ + \`
- «\\» + \<
- «test» + \\

Whitespace???
- ⌘     +    a
- Ctrl   +    b
-    Ctrl +  z  +r

Should NOT trigger a key combo:
- CtrlD

Things that don't work quite right yet:
- Ctrl+ ⇧ + A

## Inline-ish contexts

### Shortcuts should appear ⌘ + A, in headings

### Even when wrapped «H» + «I», yes

### Even when there's weird stuff «test» + \\

### Shortcuts should basically all work in plain text:

Basic combos:
⌘
⌘A
⌘ + B
⌘ + CTRL + C
Ctrl + D

With literals:
«A»
«ABC»
«D😊E»
«F + G»
«⌘»
«⌘» + H
«H» + «I»

Weirder stuff:
⌘ + \`
«\\» + \<
«test» + \\

Whitespace???
 ⌘     +    a
 Ctrl   +    b
    Ctrl +  z  +r

### And...

*Shortcuts should work in italics ⌘ + A, yes*, and in bold **⌘ + A, yes**, but not if you try to overlap them like this **⌘** + A -- nope.

Shorcuts should work in links like this [⌘ + A](https://obsidian.md), or like this [⌘ + A][1], or like this [My Link ⌘ + A is here](https://obsidian.md).

[1]: https://obsidian.md

## Block-ish contexts

Shortcuts should work in blockquotes like this:

> Press ⌘ + B to detonate.
> Press «CMD» + «OPT» + \< to cancel.

Shorcuts should also work in Callouts like this:

> [!NOTE] In the «⌘» + \` title of a callout,
> Or in the body «Cmd» + \\ + K...

Shorcuts should NOT work in code blocks like this:

```js
⌘ + A
«CMD» + «OPT» + \<
```

And nor should they work in inline code like this: `⌘ + A`,  `or like this: «CMD» + «OPT» + \<`
