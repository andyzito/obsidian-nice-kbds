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
	useAutoFormat: boolean;
	useManualFormat: boolean;
	useStyles: boolean;
	triggerCharacters: string; // Any one of these characters will trigger a key combo even if not wrapped in \b.
	triggerWords: string; // These words will trigger a key combo, must be wrapped in \b. Case insensitive.
	additionalCharacters: string; // These characters are allowed in keys after a key combo has been triggered.
	kbdWrapperForce: string; // Characters to force a <kbd> tag. Separate open and close with a comma.
}

const DEFAULT_SETTINGS: NiceKBDsSettings = {
	//https://wincent.com/wiki/Unicode_representations_of_modifier_keys
	useAutoFormat: true,
	useManualFormat: true,
	useStyles: true,
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
			.setName('Auto Format')
			.setDesc('Automatically format key combos in read mode.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useAutoFormat)
				.onChange(async (value) => {
					this.plugin.settings.useAutoFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Manual Format')
			.setDesc('Manually format key combos in edit mode.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useManualFormat)
				.onChange(async (value) => {
					this.plugin.settings.useManualFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Styles')
			.setDesc('Use the default styles for <kbd> tags.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useStyles)
				.onChange(async (value) => {
					this.plugin.settings.useStyles = value;
					await this.plugin.saveSettings();
				}));

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
	constructor(private key: string, private settings: NiceKBDsSettings) {
		super();
	}

	toDOM() {
		return new KBDFactory(this.settings).getElement(this.key);
	}
}

class KBDFactory {
	constructor(private settings: NiceKBDsSettings) {}

	getClassName() {
		return this.settings.useStyles ? 'nice-kbd' : '';
	}

	getMark() {
		return Decoration.mark({
			inclusive: true,
			class: this.getClassName(),
			tagName: 'kbd',
		})
	}

	getWidget(key: string) {
		return new KBDWidget(key, this.settings);
	}

	getElement(key: string) {
		const element = document.createElement('kbd');
		element.className = this.getClassName();
		element.innerText = key;
		return element;
	}

	getHTML(key: string) {
		return this.getElement(key).outerHTML;
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
							widget: new KBDFactory(settings).getWidget(keyText.replace(/\\(.{1})/g, '$1')), // Unescape formatting characters, sort of. TODO: This is not perfect.
						}).range(from, from + groupText?.length),
					)
				}
			} else {
				// Otherwise, just use a kbd tag.
				decorations.push(new KBDFactory(settings).getMark().range(from, from + groupText?.length));

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
			 * EDIT: This also applies to ^quote, etc.
			 */
			if (node.name.match(/^hmd-table-sep|^header|^quote|^list|formatting/)) return;

			const nodeText = transaction.state.doc.sliceString(node.from, node.to);

			walkThroughKeyCombos(
				nodeText,
				R,
				settings,
				(combo) => {
					const docFrom = node.from + combo.from;
					indices[docFrom] = [];

					if (node.name.match(/comment|hashtag|code|escape|strikethrough/)) {
						excludeIndices.add(docFrom.toString());
						return;
					}
				},
				(key) => {
					const comboDocFrom = node.from + key.comboFrom;
					const comboDocTo = node.from + key.comboTo;
					const keyDocFrom = comboDocFrom + key.comboOffset;

					let mode = 'read'
					const selectionRanges = transaction.state.selection.ranges;
					for (const range of selectionRanges) {
						if ((comboDocFrom <= range.to && comboDocTo >= range.from) || (comboDocFrom >= range.from && comboDocTo <= range.to)) {
							mode = 'edit';
							break;
						}
					}

					// If we have special markdown formatting...
					if (key.trimmedText.match(new RegExp(`[${regEscape(R.formattingCharacters)}]`))) {
						if (mode === 'read') { // And we're in read mode...
							// Use a replace widget to avoid conflict with Obsidian's live formatting.
							indices[comboDocFrom].push(
								Decoration.replace({
									widget: new KBDFactory(settings).getWidget(key.trimmedText.replace(/\\(.{1})/g, '$1')), // Unescape formatting characters, sort of. TODO: This is not perfect.
								}).range(keyDocFrom, keyDocFrom + key.wholeText.length),
							)
						}
					} else {
						// Otherwise, just use a kbd tag.
						indices[comboDocFrom].push(new KBDFactory(settings).getMark().range(keyDocFrom, keyDocFrom + key.wholeText.length));

						// And hide the wrapper characters if we're in read mode.
						// In the formatting char case, we don't need to do this because the widget is replacing the whole thing.
						let wrapperMatch = key.wholeText.match(R.wrappedKey)
						if (wrapperMatch?.index !== undefined && mode === 'read') {
							indices[comboDocFrom].push(Decoration.replace({
								inclusive: true,
							}).range(keyDocFrom, keyDocFrom + indexOfGroup(wrapperMatch, 1) + wrapperMatch[1].length))
							indices[comboDocFrom].push(Decoration.replace({
								inclusive: true,
							}).range(keyDocFrom + indexOfGroup(wrapperMatch, 3), keyDocFrom + indexOfGroup(wrapperMatch, 3) + wrapperMatch[3].length))
						}
					}
				}
			)
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

// The post-processor handles reading view and live edit callouts.
const getNiceKBDsPostProcessor = (settings: NiceKBDsSettings) => (element: HTMLElement, context: any) => {
	const replaceInnerHTMLForKBD = (el: HTMLElement) => {
		const R = getNiceKBDsRegexes(settings, true); // true: Different mode for pre-processing.

		// Recurse through child nodes and perform find-replace on TEXT_NODEs.
		const processNode = (node: HTMLElement) => {
			// Ignore code, strikethrough, tags, comments (not technically needed since they are hidden in read mode, but better to be explicit)
			const ignoreElements = ['CODE', 'PRE', 'DEL'];
			if (ignoreElements.includes(node.nodeName) || node.classList.contains('tag') || node.classList.contains('cm-comment')) return node.outerHTML;

			let newInnerHTML = '';
			for (let childNode of Array.from(node.childNodes)) {
				if (childNode.nodeType === Node.TEXT_NODE) {
					const text = childNode.textContent ?? '';
					let newText = '';
					const lastIndex = walkThroughKeyCombos(
						text,
						R,
						settings,
						(combo) => {
							newText += text.slice(combo.lastIndex, combo.from);
						},
						(key) => {
							// const keyText = key.wholeText.replace(new RegExp(`^${R.openWrapper}|${R.closeWrapper}$`, 'gi'), '').trim();
							newText += key.sep;
							newText += new KBDFactory(settings).getHTML(key.trimmedText);
						}
					);

					newText += text.slice(lastIndex);
					newInnerHTML += newText;
				} else if (childNode.nodeType === Node.ELEMENT_NODE) {
					newInnerHTML += processNode(childNode as HTMLElement);
				}
			}

			node.innerHTML = newInnerHTML; // This might be bad.
			return node.outerHTML;
		}

		/* We iterate through childNodes and build newInnerHTML with find-replace done on TEXT_NODEs.
		 * This is because we want to avoid matching across sibling elements.
		 */
		el.innerHTML = processNode(el);
	}

	const selector = 'p,div.callout-title-inner,td,div.table-cell-wrapper,li,h1,h2,h3,h4,h5,h6'
	if (element.matches(selector)) {
		replaceInnerHTMLForKBD(element);
	} else {
		for (const el of element.findAll(selector)) {
			if (el.innerText) {
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

const walkThroughKeyCombos = (
	string: string,
	R: ReturnType<typeof getNiceKBDsRegexes>,
	settings: NiceKBDsSettings,
	processCombo: (...args: any[]) => void,
	processKey: (...args: any[]) => void
) => {
	let wholeMatch;
	let lastIndex = 0;
	// I'm sure there's a way to make this cleaner. I'll get there.
	// Probably using `yield` or something.
	// Also interfaces.
	while ((wholeMatch = R.wholeRegex.exec(string))) {
		const comboFrom: number = wholeMatch.index;
		const comboTo: number = wholeMatch.index + wholeMatch[0].length;

		processCombo({
			lastIndex,
			from: comboFrom,
			to: comboTo,
		});

		// First we add the initial key, stripped and trimmed.
		processKey({
			wholeText: wholeMatch.groups?.initialKey,
			trimmedText: wholeMatch.groups?.initialKey.replace(new RegExp(`^${R.openWrapper}|${R.closeWrapper}$`, 'gi'), '').trim(),
			sep: '',
			comboFrom,
			comboTo,
			comboOffset: 0,
		})

		let addKeysMatch; // Then we add any additional keys, stripped and trimmed.
		while (addKeysMatch = R.addKeys.exec(wholeMatch[0].slice(wholeMatch.groups?.initialKey?.length))) {
			processKey({
				wholeText: addKeysMatch.groups?.key,
				trimmedText: addKeysMatch.groups?.key.replace(new RegExp(`^${R.openWrapper}|${R.closeWrapper}$`, 'gi'), '').trim(),
				sep: addKeysMatch.groups?.sep,
				comboFrom,
				comboTo,
				comboOffset: (wholeMatch.groups?.initialKey?.length ?? 0) + addKeysMatch.index + (addKeysMatch.groups?.sep?.length ?? 0),
			});
		}

		lastIndex = wholeMatch.index + wholeMatch[0].length;
	}

	return lastIndex;
};

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
