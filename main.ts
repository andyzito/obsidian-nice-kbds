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
	MatchDecorator,
	ViewPlugin,
	ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { Range, StateField, Transaction, Extension } from '@codemirror/state';
import { match } from 'assert';

interface NiceKBDsSettings {
	characters: string;
	additionalCharacters: string;
	words: string;
	kbdWrapperForce: string;
}

const DEFAULT_SETTINGS: NiceKBDsSettings = {
	//https://wincent.com/wiki/Unicode_representations_of_modifier_keys
	characters: '⌘⇧⇪⇥⎋⌃⌥⎇␣⏎⌫⌦⇱⇲⇞⇟⌧⇭⌤⏏⌽',
	additionalCharacters: '↑⇡↓⇣←⇠→⇢|\\{}[]~!@#$%^&*()_+`-=;:\'"<>,./?',
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

class HideWidget extends WidgetType {
	toDOM() {
		const element = document.createElement("span");
		element.style.display = "none";
		return element;
	}
}

const getNiceKBDsViewPlugin = (settings: NiceKBDsSettings) => ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	kbdDecorator: MatchDecorator;

	constructor(view: EditorView) {
		const characters = settings.characters;
		const words = settings.words.split(',').join('|');
		const initialKeyRegex = new RegExp(`([${characters}]+\\w*)|${words}`)
		const subsequentKeyRegex = new RegExp(`(${initialKeyRegex.source}|\\w)+`)
		const addKeysRegex = new RegExp(`(?<sep>\\s*\\+\\s*)(?<key>${subsequentKeyRegex.source})`, 'gi')
		const wholeRegex = new RegExp(`(?<initialKey>${initialKeyRegex.source})(${addKeysRegex.source})*`, 'gi')

		this.kbdDecorator = new MatchDecorator({
			regexp: wholeRegex,
			decorate(add, from, to, match, view) {
				add(
					from,
					from + (match.groups?.initialKey?.length ?? 0),
					Decoration.mark({
						inclusive: true,
						class: "nice-kbd",
						tagName: "kbd",
					})
				)

				let addKeysMatch;
				while ((addKeysMatch = addKeysRegex.exec(match[0]))) {
					add(
						from + addKeysMatch.index + (addKeysMatch.groups?.sep?.length ?? 0),
						from + addKeysMatch.index + addKeysMatch[0].length,
						Decoration.mark({
							inclusive: true,
							class: "nice-kbd",
							tagName: "kbd",
						})
					)
				}

			}
		})

		this.decorations = this.kbdDecorator.createDeco(view);
	}

	update(update: ViewUpdate) {
		this.decorations = this.kbdDecorator.updateDeco(update, this.decorations);
	}
}, {
  decorations: instance => instance.decorations,
})

const getNiceKBDsStateField = (settings: NiceKBDsSettings) => StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},

	update(prev: DecorationSet, transaction: Transaction): DecorationSet {
		const R = getNiceKBDsRegexes(settings);

		const isSourceMode = !transaction.state.field(editorLivePreviewField);
		if (isSourceMode) return Decoration.none;

		const includeIndices = new Set<string>();
		const excludeIndices = new Set<string>();

		const decorations: Range<Decoration>[] = [];

		syntaxTree(transaction.state).iterate({
			enter(node){
				if (node.name.match(/formatting|HyperMD/)) return;

				let indices = includeIndices
				if (node.name.match(/hashtag|code/)) {
					indices = excludeIndices;
				}

				const text = transaction.state.doc.sliceString(node.from, node.to);

				let wholeMatch;
				while ((wholeMatch = R.wholeRegex.exec(text))) {
					// Check if wholeMatch is overlapping selection ranges
					const docFrom = node.from + wholeMatch.index;
					const docTo = node.from + wholeMatch.index + wholeMatch[0].length;
					let mode = 'read'
					const selectionRanges = transaction.state.selection.ranges;
					for (const range of selectionRanges) {
						if ((docFrom <= range.to && docTo >= range.from) || (docFrom >= range.from && docTo <= range.to)) {
							mode = 'edit';
							break;
						}
					}

					indices.add([
						node.from + wholeMatch.index,
						node.from + wholeMatch.index + (wholeMatch.groups?.initialKey?.length ?? 0)
					].join(','));

					if (wholeMatch.groups?.initialKey?.match(R.wrapperRegex) && mode === 'read') {
						decorations.push(Decoration.replace({
							widget: new HideWidget(),
						}).range(node.from + wholeMatch.index, node.from + wholeMatch.index + 1))
						decorations.push(Decoration.replace({
							widget: new HideWidget(),
						}).range(node.from + wholeMatch.index + wholeMatch.groups?.initialKey?.length - 1, node.from + wholeMatch.index + wholeMatch.groups?.initialKey?.length))
					}

					let addKeysMatch;
					console.log(wholeMatch[0].slice(wholeMatch.groups?.initialKey.length))
					while ((addKeysMatch = R.addKeysRegex.exec(wholeMatch[0].slice(wholeMatch.groups?.initialKey.length)))) {
						indices.add([
							node.from + wholeMatch.index + (wholeMatch.groups?.initialKey.length ?? 0) + addKeysMatch.index + (addKeysMatch.groups?.sep?.length ?? 0),
							node.from + wholeMatch.index + (wholeMatch.groups?.initialKey.length ?? 0) + addKeysMatch.index + addKeysMatch[0].length
						].join(','));
					}
				}
			}
		})

		for (const indices of includeIndices) {
			if (excludeIndices.has(indices)) continue;
			const [start, end] = indices.split(',').map(Number);
			decorations.push(Decoration.mark({
				inclusive: true,
				class: "nice-kbd",
				tagName: "kbd",
			}).range(start, end))
		}

		return Decoration.set(decorations, true);
	},

	provide(field: StateField<DecorationSet>): Extension {
		return EditorView.decorations.from(field);
	}
})

const getNiceKBDsPostProcessor = (settings: NiceKBDsSettings) => (element: HTMLElement, context: any) => {
	const replaceInnerHTMLForKBD = (el: HTMLElement) => {
		const R = getNiceKBDsRegexes(settings);

		// const fuzzyGetMatchGroup = (match: RegExpExecArray, groupName: string) => {
		// 	// Return the first group that matches /[a-z]${groupName}/i
		// 	const fuzzyRegex = new RegExp(`[a-z]?${groupName}`, 'i');
		// 	for (const [key, value] of Object.entries(match.groups ?? {})) {
		// 		if (fuzzyRegex.test(key) && value !== undefined) return value;
		// 	}
		// }

		const innerHTML = el.innerHTML;
		let newInnerHTML = '';

		let wholeMatch;
		let lastIndex = 0;
		while (wholeMatch = R.wholeRegex.exec(innerHTML)) {
			newInnerHTML += innerHTML.slice(lastIndex, wholeMatch.index);

			const rawInitialKey = wholeMatch.groups?.initialKey;
			const initialKey = rawInitialKey?.replace(/^«|»$/g, '').trim();
			newInnerHTML += `<kbd class="nice-kbd">${initialKey}</kbd>`;

			let addKeysMatch;
			while (addKeysMatch = R.addKeysRegex.exec(wholeMatch[0].slice(rawInitialKey?.length))) {
				console.log(addKeysMatch)
				newInnerHTML += `${addKeysMatch.groups?.sep}<kbd class="nice-kbd">${addKeysMatch.groups?.key}</kbd>`;
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
				if (el.findAll('.tag,code').length > 0) continue;
				replaceInnerHTMLForKBD(el);
			}
		}
	}
}

const getNiceKBDsRegexes = (settings: NiceKBDsSettings) => {
	const characters = settings.characters;
	const additionalCharacters = settings.additionalCharacters;
	const words = settings.words.split(',').join('|');
	const openWrapper = settings.kbdWrapperForce.split(',')[0];
	const closeWrapper = settings.kbdWrapperForce.split(',')[1];

	const initialKeyRegex = new RegExp(`([${characters}]+[${additionalCharacters}\\w]*)|${words}`)
	const wrapperRegex = new RegExp(`${openWrapper}.*?${closeWrapper}`)
	const subsequentKeyRegex = new RegExp(`([${characters}${additionalCharacters}\\w])+`)
	const addKeysRegex = new RegExp(`(?<sep> *\\+ *)(?<key>${subsequentKeyRegex.source})`, 'gi')

	const wholeRegex = new RegExp(`(?<initialKey>${initialKeyRegex.source}|${wrapperRegex.source})(${addKeysRegex.source})*`, 'gi')

	return {
		// characters,
		// additionalCharacters,
		// words,
		openWrapper,
		closeWrapper,
		initialKeyRegex,
		wrapperRegex,
		addKeysRegex,
		wholeRegex,
	}
}

export default class NiceKBDsPlugin extends Plugin {
	settings: NiceKBDsSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new NiceKBDsSettingsTab(this.app, this));

		// this.registerEditorExtension(getNiceKBDsViewPlugin(this.settings))
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
