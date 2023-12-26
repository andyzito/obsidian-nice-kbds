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
	MatchDecorator,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { Range, StateField, Transaction, Extension } from '@codemirror/state';
import { get } from 'http';

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
				console.log(from, to)
				console.log(`Found match: ${match[0]} at ${match.index} to ${match.index + match[0].length}`)
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

export default class NiceKBDsPlugin extends Plugin {
	settings: NiceKBDsSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new NiceKBDsSettingsTab(this.app, this));

		this.registerEditorExtension(getNiceKBDsViewPlugin(this.settings))
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
