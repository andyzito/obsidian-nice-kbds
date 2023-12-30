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
	characters: string;
	additionalCharacters: string;
	words: string;
	kbdWrapperForce: string;
}

const DEFAULT_SETTINGS: NiceKBDsSettings = {
	//https://wincent.com/wiki/Unicode_representations_of_modifier_keys
	characters: '⌘⇧⇪⇥⎋⌃⌥⎇␣⏎⌫⌦⇱⇲⇞⇟⌧⇭⌤⏏⌽',
	additionalCharacters: '\\`↑⇡↓⇣←⇠→⇢|~!@#$%^&*_+-=;:<>,./?',
	words: 'ctrl',
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
			.setDesc('Characters that will trigger a <kbd> tag.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.characters)
				.setValue(this.plugin.settings.characters)
				.onChange(async (value) => {
					this.plugin.settings.characters = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Additional Characters')
			.setDesc('Characters that will work in an additional key but not trigger a key sequence.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.additionalCharacters)
				.setValue(this.plugin.settings.additionalCharacters)
				.onChange(async (value) => {
					this.plugin.settings.additionalCharacters = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Words')
			.setDesc('Words that will trigger a <kbd> tag. Case insensitive, comma separated.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.words)
				.setValue(this.plugin.settings.words)
				.onChange(async (value) => {
					this.plugin.settings.words = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Force KBD Wrapper')
			.setDesc('Use like any other Markdown syntax to denote a KBD. Separate open and close with a comma.')
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

const getNiceKBDsStateField = (settings: NiceKBDsSettings) => StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},

	update(prev: DecorationSet, transaction: Transaction): DecorationSet {
		const R = getNiceKBDsRegexes(settings);

		const isSourceMode = !transaction.state.field(editorLivePreviewField);
		if (isSourceMode) return Decoration.none;

		const decorations: Range<Decoration>[] = [];
		const indices: Record<number, Range<Decoration>[]> = {};
		const excludeIndices = new Set<string>();


		syntaxTree(transaction.state).iterate({enter(node){
			// Ignore formatting nodes.
			if (node.name.match(/list|formatting|HyperMD/)) return;

			const nodeText = transaction.state.doc.sliceString(node.from, node.to);

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
					// And we're in read mode...
					if (mode === 'read') {
						// Use a replace widget to get around the markdown formatting.
						decorations.push(
							Decoration.replace({
								widget: new KBDWidget(keyText.replace(/\\(.{1})/g, '$1')),
							}).range(from, from + groupText?.length),
						)
					}
				} else {
					decorations.push(
						Decoration.mark({
							inclusive: true,
							class: "nice-kbd",
							tagName: "kbd",
						}).range(from, from + groupText?.length),
					)
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

			let wholeMatch;
			while (wholeMatch = R.wholeRegex.exec(nodeText)) {
				const docFrom = node.from + wholeMatch.index;
				const docTo = node.from + wholeMatch.index + wholeMatch[0].length;

				// Exclude some nodes like code or tags.
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

				indices[docFrom].push(...processKey(wholeMatch, 'initialKey', mode, docFrom, docTo));

				let addKeysMatch;
				while (addKeysMatch = R.addKeys.exec(wholeMatch[0].slice(wholeMatch.groups?.initialKey.length))) {
					indices[docFrom].push(...processKey(
						addKeysMatch,
						'key',
						mode,
						docFrom + (wholeMatch.groups?.initialKey.length ?? 0) + addKeysMatch.index + (addKeysMatch.groups?.sep?.length ?? 0),
						docFrom + (wholeMatch.groups?.initialKey.length ?? 0) + addKeysMatch.index + addKeysMatch[0].length
					));
				}
			}
		}})

		for (const [index, _decorations] of Object.entries(indices)) {
			if (excludeIndices.has(index)) continue;
			decorations.push(..._decorations);
		}

		return Decoration.set(decorations, true);
	},

	provide(field: StateField<DecorationSet>): Extension {
		return EditorView.decorations.from(field);
	}
})

const getNiceKBDsPostProcessor = (settings: NiceKBDsSettings) => (element: HTMLElement, context: any) => {
	const replaceInnerHTMLForKBD = (el: HTMLElement) => {
		const R = getNiceKBDsRegexes(settings, true);

		const innerHTML = el.innerHTML;
		let newInnerHTML = '';

		let wholeMatch;
		let lastIndex = 0;
		while (wholeMatch = R.wholeRegex.exec(innerHTML)) {
			if (wholeMatch[0].match(/<[a-zA-Z]+>/g)) continue;
			newInnerHTML += innerHTML.slice(lastIndex, wholeMatch.index);

			const initialKey = wholeMatch.groups?.initialKey?.replace(new RegExp(`^${R.openWrapper}|${R.closeWrapper}$`, 'gi'), '').trim();

			newInnerHTML += `<kbd class="nice-kbd">${initialKey}</kbd>`;

			let addKeysMatch;
			while (addKeysMatch = R.addKeys.exec(wholeMatch[0].slice(wholeMatch.groups?.initialKey?.length))) {
				const keyText = addKeysMatch.groups?.key?.replace(new RegExp(`^${R.openWrapper}|${R.closeWrapper}$`, 'gi'), '').trim();
				newInnerHTML += `${addKeysMatch.groups?.sep}<kbd class="nice-kbd">${keyText}</kbd>`;
			}

			lastIndex = wholeMatch.index + wholeMatch[0].length;
		}
		newInnerHTML += innerHTML.slice(lastIndex);
		el.innerHTML = newInnerHTML;
	}

	for (const el of element.findAll('p,li,div,h1,h2,h3,h4,h5,h6,h7')) {
		if (el.innerText) {
			if (el.nodeName === 'DIV') {
				if (el.classList.contains('callout-title-inner')) {
					replaceInnerHTMLForKBD(el);
				}
			} else {
				// if (el.findAll('.tag,code').length > 0) continue;
				if (el.findAll('.tag').length > 0) continue;
				replaceInnerHTMLForKBD(el);
			}
		}
	}
}

const getNiceKBDsRegexes = (settings: NiceKBDsSettings, postProcessing: boolean = false) => {
	const formattingCharacters = '\\`[]<>*' // Need special handling b/c Markdown formatting
	const triggerCharacters = settings.characters;
	const triggerWords = settings.words.split(',').map(w => '\\b' + w + '\\b').join('|');
	const triggers = `[${triggerCharacters}]|${triggerWords}`;

	let additionalCharacters = regEscape(settings.additionalCharacters)
	const escapedFormattingCharacters = []

	if (!postProcessing) {
		for (const char of settings.additionalCharacters) {
			if (formattingCharacters.includes(char)) {
				escapedFormattingCharacters.push(regEscape(`\\${char}`))
			}
		}
		additionalCharacters = regEscape(settings.additionalCharacters
			.replace(new RegExp(`[${regEscape(formattingCharacters)}]`, 'gi'), ''))
	}

	const formattingCharactersMatch =
		escapedFormattingCharacters.length > 0
		? '|' + escapedFormattingCharacters.join('|')
		: '';
	const allCharacters = `[${triggerCharacters}${additionalCharacters}\\w]${formattingCharactersMatch}`

	const openWrapper = settings.kbdWrapperForce.split(',')[0];
	const closeWrapper = settings.kbdWrapperForce.split(',')[1];

	const inWrapper = postProcessing ? `[^\\n]*?` : `([^\\n${regEscape(formattingCharacters)}]|${formattingCharactersMatch})*?`
	const wrappedKey = `(${openWrapper}\\s*)(${inWrapper})(\\s*${closeWrapper})`
	const initialKey = `((${triggers})(${allCharacters})*)|${wrappedKey}`
	const additionalKey = `(${allCharacters})+|${wrappedKey}`
	const addKeys = `(?<sep> *\\+ *)(?<key>${additionalKey})`

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

		this.registerEditorExtension(getNiceKBDsStateField(this.settings))

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
