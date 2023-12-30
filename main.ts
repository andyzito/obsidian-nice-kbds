import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	editorLivePreviewField
} from 'obsidian';
import {
	EditorView,
	Decoration,
	DecorationSet,
	WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { Range, StateField, Transaction, Extension } from '@codemirror/state';

function indexOfGroup(match: RegExpMatchArray, n: number) {
	var ix = match.index ?? 0;
	for (var i = 1; i < n; i++)
			ix += match[i].length;
	return ix;
}

function regEscape(string: string) {
	// https://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
	// $& means the whole matched string
	return string.replace(/[-.*+?^${}()|[\]\\]/g, '\\$&');
}

interface NiceKBDsSettings {
	triggerCharacters: string; // Any one of these characters will trigger a key combo even if not wrapped in \b.
	triggerWords: string; // These words will trigger a key combo, must be wrapped in \b. Case insensitive.
	additionalCharacters: string; // These characters are allowed in keys after a key combo has been triggered.
	kbdWrapperForce: string; // Characters to force a <kbd> tag. Separate open and close with a comma.
}

const DEFAULT_SETTINGS: NiceKBDsSettings = {
	//https://wincent.com/wiki/Unicode_representations_of_modifier_keys
	triggerCharacters: '⌘⇧⇪⇥⎋⌃⌥⎇␣⏎⌫⌦⇱⇲⇞⇟⌧⇭⌤⏏⌽',
	triggerWords: 'ctrl',
	additionalCharacters: '\\`<>[]{}↑⇡↓⇣←⇠→⇢|~!@#$%^&*_+-=;:,./?',
	kbdWrapperForce: '«,»',
}

class NiceKBDsSettingsTab extends PluginSettingTab {
	plugin: NiceKBDsPlugin;

	constructor(app: App, plugin: NiceKBDsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Characters')
			.setDesc('Any of these characters will trigger a <kbd> tag.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.triggerCharacters)
				.setValue(this.plugin.settings.triggerCharacters)
				.onChange(async (value) => {
					this.plugin.settings.triggerCharacters = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Additional Characters')
			.setDesc('These characters are allowed in keys after a key combo has been triggered.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.additionalCharacters)
				.setValue(this.plugin.settings.additionalCharacters)
				.onChange(async (value) => {
					this.plugin.settings.additionalCharacters = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Words')
			.setDesc('These words will trigger a key combo. Case insensitive. Separate with commas.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.triggerWords)
				.setValue(this.plugin.settings.triggerWords)
				.onChange(async (value) => {
					this.plugin.settings.triggerWords = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Force KBD Wrapper')
			.setDesc('Characters to force a <kbd> tag. Separate open and close with a comma. We recommend the use of a plugin like Smart Typography.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.kbdWrapperForce)
				.setValue(this.plugin.settings.kbdWrapperForce)
				.onChange(async (value) => {
					this.plugin.settings.kbdWrapperForce = value;
					await this.plugin.saveSettings();
				}));
	}
}

class KBDWidget extends WidgetType {
	constructor(public key: string) {
		super();
	}

	toDOM() {
		const element = document.createElement("kbd");
		element.className = "nice-kbd";
		element.innerText = this.key;
		return element;
	}
}

// The StateField handles live editing (except for some special cases like callouts, which use post-processing).
const getNiceKBDsStateField = (settings: NiceKBDsSettings) => StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},

	update(prev: DecorationSet, transaction: Transaction): DecorationSet {
		const R = getNiceKBDsRegexes(settings);

		const processKey = (
			match: RegExpMatchArray,
			groupName: string,
			mode: string,
			from: any,
			to: any
		) => {
			const decorations: Range<Decoration>[] = [];
			const groupText = match.groups?.[groupName]
			const keyText = match.groups?.[groupName].replace(new RegExp(`^${R.openWrapper}|${R.closeWrapper}$`, 'gi'), '').trim();

			// If we have special markdown formatting...
			if (keyText?.match(new RegExp(`[${regEscape(R.formattingCharacters)}]`))) {
				if (mode === 'read') { // And we're in read mode...
					// Use a replace widget to avoid conflict with Obsidian's live formatting.
					decorations.push(
						Decoration.replace({
							widget: new KBDWidget(keyText.replace(/\\(.{1})/g, '$1')), // Unescape formatting characters, sort of. TODO: This is not perfect.
						}).range(from, from + groupText?.length),
					)
				}
			} else {
				// Otherwise, just use a kbd tag.
				decorations.push(
					Decoration.mark({
						inclusive: true,
						class: "nice-kbd",
						tagName: "kbd",
					}).range(from, from + groupText?.length),
				)

				// And hide the wrapper characters if we're in read mode.
				// In the formatting char case, we don't need to do this because the widget is replacing the whole thing.
				let wrapperMatch = groupText?.match(R.wrappedKey)
				if (wrapperMatch?.index !== undefined && mode === 'read') {
					decorations.push(Decoration.replace({
						inclusive: true,
					}).range(from, from + indexOfGroup(wrapperMatch, 1) + wrapperMatch[1].length))
					decorations.push(Decoration.replace({
						inclusive: true,
					}).range(from + indexOfGroup(wrapperMatch, 3), from + indexOfGroup(wrapperMatch, 3) + wrapperMatch[3].length))
				}
			}

			return decorations;
		}

		// No decorations if we're in source mode.
		const isSourceMode = !transaction.state.field(editorLivePreviewField);
		if (isSourceMode) return Decoration.none;

		const decorations: Range<Decoration>[] = [];
		const indices: Record<number, Range<Decoration>[]> = {}; // This will hold decorations mapped by combo.
		const excludeIndices = new Set<string>(); // For excluding nodes like <code> or <tag>s.

		syntaxTree(transaction.state).iterate({enter(node){
			// Ignore formatting and other troublesome nodes.
			/* The `^list` is important; remember that list child nodes also have `list` in their name.
			 *  - If you use just `list`, key combos in child ignore blocks (like <code>) will be matched,
			 *      because the <code> block will never be processed and detected by excludeIndices.
			 *  - If you remove `list` entirely, list-items will cause conflicts with child elements,
			 *      e.g. `- ⌘ + \\` will fail because the escaped character `\\` will not be part of
			 *      the base list-item, and therefore the key combo will first be matched as
			 *      just `⌘ +`, excluding the escaped character.
			 */
			if (node.name.match(/^quote|^list|formatting|HyperMD/)) return;

			const nodeText = transaction.state.doc.sliceString(node.from, node.to);
			console.log(node.name, nodeText)

			let wholeMatch; // This is the whole combo, e.g. `⌘ + A + C`
			while (wholeMatch = R.wholeRegex.exec(nodeText)) {
				const docFrom = node.from + wholeMatch.index;
				const docTo = node.from + wholeMatch.index + wholeMatch[0].length;

				// Exclude some nodes like <code> or <tag>s. This is essential to override matches at the Document level.
				// We cannot exclude Document entirely because basic text does not get its own node(s).
				if (node.name.match(/hashtag|code|escape/)) {
					excludeIndices.add(docFrom.toString());
					continue;
				}

				// Determine if we are editing this key combo.
				let mode = 'read'
				const selectionRanges = transaction.state.selection.ranges;
				for (const range of selectionRanges) {
					if ((docFrom <= range.to && docTo >= range.from) || (docFrom >= range.from && docTo <= range.to)) {
						mode = 'edit';
						break;
					}
				}

				indices[docFrom] = [];

				// First we process the initial key, e.g. ⌘
				indices[docFrom].push(...processKey(wholeMatch, 'initialKey', mode, docFrom, docTo));

				let addKeysMatch; // Then we process any additional keys, e.g. ` + A`, ` + C`
				while (addKeysMatch = R.addKeys.exec(wholeMatch[0].slice(wholeMatch.groups?.initialKey.length))) {
					indices[docFrom].push(...processKey(
						addKeysMatch,
						'key',
						mode,
						// Base index + initial key length (already processed above) + this match index + separator length
						docFrom + (wholeMatch.groups?.initialKey.length ?? 0) + addKeysMatch.index + (addKeysMatch.groups?.sep?.length ?? 0),
						docFrom + (wholeMatch.groups?.initialKey.length ?? 0) + addKeysMatch.index + addKeysMatch[0].length
					));
				}
			}
		}})

		// Go back over our combos and add them to the decorations array unless they're excluded.
		for (const [index, _decorations] of Object.entries(indices)) {
			if (excludeIndices.has(index)) continue;
			decorations.push(..._decorations);
		}

		return Decoration.set(decorations, true);
	},

	provide(field: StateField<DecorationSet>): Extension {
		return EditorView.decorations.from(field); // This connects the decorations to the editor.
	}
})

const getNiceKBDsPostProcessor = (settings: NiceKBDsSettings) => (element: HTMLElement, context: any) => {
	const replaceInnerHTMLForKBD = (el: HTMLElement) => {
		const R = getNiceKBDsRegexes(settings, true); // true: Different mode for pre-processing.

		let newInnerHTML = '';

		/* We iterate through childNodes and match only on TEXT_NODEs.
		 * This is because we want to avoid matching across child elements.
		 * We rebuild innerHTML from replaced TEXT_NODEs and original HTML from other nodes.
		 */
		for (let node of Array.from(el.childNodes)) {
			if (node.nodeType === Node.TEXT_NODE) {
				const text = node.textContent ?? '';
				let newText = '';
				let wholeMatch;
				let lastIndex = 0;
				while (wholeMatch = R.wholeRegex.exec(text)) {
					// From the last match to the start of this match, we add the original text.
					newText += text.slice(lastIndex, wholeMatch.index);

					// Then we add the initial key, stripped and trimmed.
					const initialKey = wholeMatch.groups?.initialKey?.replace(new RegExp(`^${R.openWrapper}|${R.closeWrapper}$`, 'gi'), '').trim();
					newText += `<kbd class="nice-kbd">${initialKey}</kbd>`;

					let addKeysMatch; // Then we add any additional keys, stripped and trimmed.
					while (addKeysMatch = R.addKeys.exec(wholeMatch[0].slice(wholeMatch.groups?.initialKey?.length))) {
						const keyText = addKeysMatch.groups?.key?.replace(new RegExp(`^${R.openWrapper}|${R.closeWrapper}$`, 'gi'), '').trim();
						newText += `${addKeysMatch.groups?.sep}<kbd class="nice-kbd">${keyText}</kbd>`;
					}

					// Don't forget to update the lastIndex or everything will be bad.
					lastIndex = wholeMatch.index + wholeMatch[0].length;
				}
				// And for SURE don't forget to finish adding the rest of the text.
				newText += text.slice(lastIndex);
				newInnerHTML += newText;
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				newInnerHTML += (node as HTMLElement).outerHTML;
			}
		}

		el.innerHTML = newInnerHTML;
	}

	for (const el of element.findAll('p,li,div,h1,h2,h3,h4,h5,h6,h7')) { // I made this up.
		if (el.innerText) {
			if (el.nodeName === 'DIV') { // Most DIVs are trash...
				if (el.classList.contains('callout-title-inner')) { // ...but we do need this targeted fix for callout titles.
					replaceInnerHTMLForKBD(el);
				}
			} else {
				if (el.findAll('.tag').length > 0) continue; // Targeted ignore for tags.
				replaceInnerHTMLForKBD(el);
			}
		}
	}
}

const getNiceKBDsRegexes = (settings: NiceKBDsSettings, postProcessing: boolean = false) => {
	// Formmating characters need special handling to avoid conflict w/ Obsidian live Markdown formatting.
	const formattingCharacters = '\\`[]<>*'

	// Triggers are how we know to auto-match a key combo.
	const triggerCharacters = settings.triggerCharacters;
	const triggerWords = settings.triggerWords.split(',').map(w => '\\b' + w + '\\b').join('|'); // \b = word boundary // TODO: \b doesn't catch e.g. `Ctrl~` because ~ is not a word character.
	const triggers = `[${triggerCharacters}]|${triggerWords}`;

	// Wrapper characters are how we know to force a <kbd> tag.
	const openWrapper = settings.kbdWrapperForce.split(',')[0];
	const closeWrapper = settings.kbdWrapperForce.split(',')[1];

	// Additional characters are allowed in keys after a key combo has been triggered.
	let additionalCharacters = regEscape(settings.additionalCharacters)

	// In post-processing, there's no such thing as escaped characters;
	// see the way we're splitting NODE_TEXTs out in the post-processor.
	const escapedFormattingCharacters = []
	if (!postProcessing) {
		// If we're NOT post-processing, we sneakily replace the formatting characters with their escaped versions.
		// This way we will not attempt to match an unescaped formatting character and conflict with Obsidian's live formatting.
		for (const char of settings.additionalCharacters) {
			if (formattingCharacters.includes(char)) {
				escapedFormattingCharacters.push(regEscape(`\\${char}`))
			}
		}
		// And then we remove the formatting characters from the additional characters so we don't match them twice.
		additionalCharacters = regEscape(settings.additionalCharacters.replace(new RegExp(`[${regEscape(formattingCharacters)}]`, 'gi'), ''))
	}

	const formattingCharactersMatch =
		escapedFormattingCharacters.length > 0
		? '|' + escapedFormattingCharacters.join('|')
		: '';

	// For non-trigger characters, we allow any of the additional characters, word characters, or formatting characters.
	const allCharacters = `[${triggerCharacters}${additionalCharacters}\\w]${formattingCharactersMatch}`

	// Wrapped keys can include almost any character.
	const inWrapper = postProcessing
		? `[^\\n]+?` // In post-processing, we don't need to worry about escaped characters.
		: `([^\\n${regEscape(formattingCharacters)}]${formattingCharactersMatch})+?`
	const wrappedKey = `(${openWrapper}\\s*)(${inWrapper})(\\s*${closeWrapper})`

	// Initial keys must start with a trigger character or word, or be wrapped.
	const initialKey = `((${triggers})(${allCharacters})*)|${wrappedKey}`

	// Additional keys can be any of the allowed characters, or be wrapped.
	const additionalKey = `\\w+|(${allCharacters}){1}|${wrappedKey}`

	// We allow multiple additional keys, separated by a plus sign.
	const addKeys = `(?<sep> *\\+ *)(?<key>${additionalKey})`

	// The whole regex is an initial key, followed by 0+ additional keys w/sep.
	const wholeRegex = new RegExp(`(?<initialKey>${initialKey})(${addKeys})*`, 'gi')

	return {
		formattingCharacters,
		openWrapper,
		closeWrapper,
		initialKey: new RegExp(initialKey, 'gi'),
		wrappedKey: new RegExp(wrappedKey, 'i'),
		addKeys: new RegExp(addKeys, 'gi'),
		wholeRegex,
	}
}

export default class NiceKBDsPlugin extends Plugin {
	settings: NiceKBDsSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new NiceKBDsSettingsTab(this.app, this));

		// The editor extension handles live editing.
		this.registerEditorExtension(getNiceKBDsStateField(this.settings))

		// The post-processor handles reading view and live edit callouts.
		this.registerMarkdownPostProcessor(getNiceKBDsPostProcessor(this.settings));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
