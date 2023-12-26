import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	editorEditorField,
	editorLivePreviewField
} from 'obsidian';
import {
	EditorView,
	Decoration,
	DecorationSet,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { Range, StateField, Transaction, Extension } from '@codemirror/state';

interface NiceKBDsSettings {
	characters: string;
	words: string;
}

const DEFAULT_SETTINGS: NiceKBDsSettings = {
	//https://wincent.com/wiki/Unicode_representations_of_modifier_keys
	characters: '⌘⇧⇪⇥⎋⌃⌥␣⏎⌫⌦⇱⇲⇞⇟',
	words: 'ctrl',
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
			.setName('Words')
			.setDesc('Words that will trigger a <kbd> tag. Case insensitive, comma separated.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.words)
				.setValue(this.plugin.settings.words)
				.onChange(async (value) => {
					this.plugin.settings.words = value;
					await this.plugin.saveSettings();
				}));
	}
}

export const createNiceKBDsEditorExtension = (settings: NiceKBDsSettings) => StateField.define<DecorationSet>({
	create() {
		return Decoration.none;
	},

	update(prev: DecorationSet, tr: Transaction): DecorationSet {
		const { state } = tr;
		const view = state.field(editorEditorField);

		if (view.composing) return prev.map(tr.changes); // User is using IME

		const isSourceMode = !state.field(editorLivePreviewField);
		if (isSourceMode) return Decoration.none;

		const decorations: Range<Decoration>[] = [];

		for (let { from, to } of view.visibleRanges) {
			syntaxTree(state).iterate({
				from,
				to,
				enter(node) {
					const text = state.doc.sliceString(node.from, node.to);

					const indicesForKBDs = new Array<[number, number]>();

					const characters = settings.characters;
					const words = settings.words.split(',').join('|');
					const initialKeyRegex = new RegExp(`([${characters}]+\\w*)|${words}`)
					const subsequentKeyRegex = new RegExp(`(${initialKeyRegex.source}|\\w)+`)
					const addKeysRegex = new RegExp(`(?<sep>\\s*\\+\\s*)(?<key>${subsequentKeyRegex.source})`, 'gi')
					const wholeRegex = new RegExp(`(?<initialKey>${initialKeyRegex.source})(${addKeysRegex.source})*`, 'gi')

					// TODO: Don't double up when two initial keys follow each other

					let wholeMatch;
					while ((wholeMatch = wholeRegex.exec(text))) {
						indicesForKBDs.push([
							wholeMatch.index,
							wholeMatch.index + (wholeMatch.groups?.initialKey?.length ?? 0)
						]);

						let addKeysMatch;
						while ((addKeysMatch = addKeysRegex.exec(wholeMatch[0]))) {
							indicesForKBDs.push([
								wholeMatch.index + addKeysMatch.index + (addKeysMatch.groups?.sep?.length ?? 0),
								wholeMatch.index + addKeysMatch.index + addKeysMatch[0].length
							]);
						}
					}

					for (const [start, end] of indicesForKBDs) {
						decorations.push(Decoration.mark({
							inclusive: true,
							class: "nice-kbd",
							tagName: "kbd",
						}).range(from + start, from + end))
					}
				}
			})
		}

		return Decoration.set(decorations, true);
	},

	provide(field: StateField<DecorationSet>): Extension {
		return EditorView.decorations.from(field);
	}
})

export default class NiceKBDsPlugin extends Plugin {
	settings: NiceKBDsSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new NiceKBDsSettingsTab(this.app, this));

		this.registerEditorExtension(createNiceKBDsEditorExtension(this.settings));
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
