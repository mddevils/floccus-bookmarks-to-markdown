import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';
import { join, parse } from 'path';
import { promises as fsPromises } from 'fs';
import { parseStringPromise } from 'xml2js';


interface fbmPluginSettings {
    xbelFolderPath: string;
    xbelFileName: string;
    mdFolderPath: string;
    mdFileName: string;
    backupFolderPath: string;
    keepCount: number;
    automaticUpdate: boolean;
    updateInterval: number;
}

const DEFAULT_SETTINGS: fbmPluginSettings = {
    xbelFolderPath: '',
    xbelFileName: 'bookmarks.xbel',
    mdFolderPath: '',
    mdFileName: 'bookmarks.md',
    backupFolderPath: '',
    keepCount: 5,
    automaticUpdate: false,
    updateInterval: 900,
}

export default class fbmPlugin extends Plugin {
    settings: fbmPluginSettings;

    async onload() {
        await this.loadSettings();
        
        // This creates an icon in the left ribbon.
        const bookmarkIconEl = this.addRibbonIcon('bookmark', 'Floccus Bookmarks to Markdown', (evt: MouseEvent) => {
            // Called when the user clicks the icon.
            this.processXBELFileData();
            new Notice('Floccus Bookmarks Markdown Updated!');
        });

        // Perform additional things with the ribbon
        bookmarkIconEl.addClass('my-plugin-ribbon-class');

        // This adds a settings tab so the user can configure various aspects of the plugin
        this.addSettingTab(new FBMSettingTab(this.app, this));

        // Call the processXBELFileData function based on the automatic update setting
        if (this.settings.automaticUpdate) {
            const updateInterval = this.settings.updateInterval * 1000; // Convert seconds to milliseconds
            this.registerInterval(window.setInterval(() => this.processXBELFileData(), updateInterval));
        }

        // Call the processXBELFileData function
        this.processXBELFileData();
    }

    onunload() {}

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.processXBELFileData();
    }

    async processXBELFileData() {
        const {
            xbelFolderPath,
            xbelFileName,
            mdFolderPath,
            mdFileName,
            backupFolderPath,
            keepCount,
        } = this.settings;

        // Construct the full paths
        const xbelFilePath: string = join(xbelFolderPath, xbelFileName);
        //const xbelFilePath: string = path.join(xbelFolderPath, xbelFileName);
        const mdFilePath = `${mdFolderPath}/${mdFileName}`;
        const mdFile = this.app.vault.getAbstractFileByPath(mdFilePath) as TFile;

        // Create the output folder if it doesn't exist
        const mdFolder = this.app.vault.getAbstractFileByPath(mdFolderPath) as TFolder;
        if (!mdFolder) {
            this.app.vault.createFolder(mdFolderPath);
        }

        // Check if the output file already exists and backup if necessary
        if (mdFile) {
            this.backupExistingFile(mdFile, backupFolderPath);
        }

        // Delete old backups, keeping only the specified number of most recent ones
        this.deleteOldBackups(backupFolderPath, keepCount);

        try {
            // Read the XBEL file
            const xbelData = await fsPromises.readFile(xbelFilePath, 'utf8');
        
            // Parse the XBEL file
            const result = await parseStringPromise(xbelData);
        
            // Generate the folder structure
            const mdData = this.writeFolderStructure(result.xbel);
        
            // Create the Markdown file with the generated data
            await this.app.vault.create(mdFilePath, mdData);
        } catch (error) {
            console.error('An error occurred:', error);
        }
    }
    
    backupExistingFile(file: TFile, backupFolderPath: string): void {
        // Generate a date-time suffix in the format 'yyyymmddHHMMSS' using the current timezone
        const now = new Date();
        const timeZoneOffset = now.getTimezoneOffset() * 60000; // Convert minutes to milliseconds
        const localTime = new Date(now.getTime() - timeZoneOffset);
        const dateSuffix: string = localTime.toISOString().slice(0, 19).replace(/[-T:]/g, '');

        // Create the backup folder if it doesn't exist
        const backupFolder = this.app.vault.getAbstractFileByPath(backupFolderPath) as TFolder;
        if (!backupFolder) {
            this.app.vault.createFolder(backupFolderPath);
        }

        // Create a new file name with the date-time suffix
        const fileName = file.basename;
        const fileExtension = file.extension;
        const backupFileName = `${parse(fileName).name}-${dateSuffix}.${fileExtension}`;
        const backupFilePath = `${backupFolderPath}/${backupFileName}`;
        
        // Copy the existing file to the backup file
        this.app.vault.rename(file, backupFilePath);
        
    }

    deleteOldBackups(backupFolderPath: string, keepCount: number): void {
        // Get all files in the backup folder
        const backupFolder = this.app.vault.getAbstractFileByPath(backupFolderPath) as TFolder;
        if (!backupFolder) {
            return;
        }

        const backupFiles = backupFolder.children as TFile[];

        // Sort the files by modification time in ascending order
        backupFiles.sort((a, b) => {
            const statA = a.stat;
            const statB = b.stat;
            return statA.mtime - statB.mtime;
        });

        // Delete files exceeding the keep count
        const filesToDelete = backupFiles.length - keepCount+1;
        if (filesToDelete > 0) {
            const filesToDeleteList = backupFiles.slice(0, filesToDelete);
            filesToDeleteList.forEach((file) => {
                this.app.vault.trash(file, false);
            });
        }
    }

    writeFolderStructure(element: any, level = 0): string {
        let data = '';
    
        // Process child elements (folders and bookmarks)
        if (typeof element === 'object') {
            if (element.hasOwnProperty('folder') || element.hasOwnProperty('bookmark')) {
                const folderTitle: string = element.title ? element.title[0] : 'Bookmarks';
    
                if (level !== 0) {
                    data += '\n';
                }
    
                data += '#'.repeat(level+1) + ' ' + folderTitle + '\n';
            }
    
            if (Array.isArray(element.bookmark)) {
                // Process bookmarks
                element.bookmark.forEach((bookmark: any) => {
                    const link: string = bookmark.$.href;
                    const title: string = bookmark.title[0];
                    const linkTitle = `[${title}](${link})`;
                    data += linkTitle + '\n';
                });
            }
    
            if (Array.isArray(element.folder)) {
                // Recursively process subfolders
                element.folder.forEach((subfolder: any) => {
                    data += this.writeFolderStructure(subfolder, level + 1);
                });
            }
        }
    
        return data;
    }
    
}

class FBMSettingTab extends PluginSettingTab {
    plugin: fbmPlugin;

    constructor(app: App, plugin: fbmPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.createEl('h2', { text: 'Floccus Bookmarks to Markdown Settings' });

        new Setting(containerEl)
        .setName('XBEL Absolute Folder Path')
        .setDesc('The absolute folder path of the XBEL file.')
        .addText((text) =>
            text
            .setValue(this.plugin.settings.xbelFolderPath)
            .onChange(async (value) => {
                this.plugin.settings.xbelFolderPath = value;
                await this.plugin.saveSettings();
            })
        );

        new Setting(containerEl)
        .setName('XBEL Filename')
        .setDesc('The filename of the XBEL file.')
        .addText((text) =>
            text
            .setValue(this.plugin.settings.xbelFileName)
            .onChange(async (value) => {
                this.plugin.settings.xbelFileName = value;
                await this.plugin.saveSettings();
            })
        );

        new Setting(containerEl)
        .setName('Markdown Vault Folder Path')
        .setDesc('The vault folder for the generated Markdown file.')
        .addText((text) =>
            text
            .setValue(this.plugin.settings.mdFolderPath)
            .onChange(async (value) => {
                this.plugin.settings.mdFolderPath = value;
                await this.plugin.saveSettings();
            })
        );

        new Setting(containerEl)
        .setName('Markdown File')
        .setDesc('The filename for the generated Markdown file.')
        .addText((text) =>
            text
            .setValue(this.plugin.settings.mdFileName)
            .onChange(async (value) => {
                this.plugin.settings.mdFileName = value;
                await this.plugin.saveSettings();
            })
        );

        new Setting(containerEl)
        .setName('Backup Folder Path')
        .setDesc('The vault folder for the backup files.')
        .addText((text) =>
            text
            .setValue(this.plugin.settings.backupFolderPath)
            .onChange(async (value) => {
                this.plugin.settings.backupFolderPath = value;
                await this.plugin.saveSettings();
            })
        );

        new Setting(containerEl)
        .setName('Number of Backups to Keep')
        .setDesc('The number of backup files to keep.')
        .addText((text) =>
            text
            .setValue(String(this.plugin.settings.keepCount))
            .onChange(async (value) => {
                const keepCount = parseInt(value, 10);
                if (!isNaN(keepCount)) {
                    this.plugin.settings.keepCount = keepCount;
                    await this.plugin.saveSettings();
                }
            })
        );

        new Setting(containerEl)
        .setName('Automatic Update Bookmarks')
        .setDesc('Enable automatic updating of bookmarks.')
        .addToggle((toggle) =>
            toggle
            .setValue(this.plugin.settings.automaticUpdate)
            .onChange(async (value) => {
                this.plugin.settings.automaticUpdate = value;
                await this.plugin.saveSettings();
            })
        );

        new Setting(containerEl)
        .setName('Update Interval (in seconds)')
        .setDesc('Specify the interval for automatic updates. Automatic Update Bookmarks must be on.')
        .addText((text) =>
            text
            .setValue(String(this.plugin.settings.updateInterval))
            .onChange(async (value) => {
                const updateInterval = parseInt(value, 10);
                if (!isNaN(updateInterval)) {
                    this.plugin.settings.updateInterval = updateInterval;
                    await this.plugin.saveSettings();
                }
            })
        );
    }
}