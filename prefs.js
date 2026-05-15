import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { TERMINAL_PROFILES, getEffectiveTerminalProfile } from "./src/terminal.js";

export default class DockerManagerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: "Docker Manager",
            icon_name: "application-x-executable-symbolic",
        });
        window.add(page);

        const displayGroup = new Adw.PreferencesGroup({
            title: "Display",
            description: "Container list behavior",
        });
        page.add(displayGroup);

        const showAllRow = new Adw.SwitchRow({
            title: "Show stopped containers",
            subtitle: "List all containers instead of only running containers",
        });
        settings.bind("show-all-containers", showAllRow, "active", Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(showAllRow);

        const groupRow = new Adw.SwitchRow({
            title: "Group by Compose project",
            subtitle: "Use Docker Compose labels when available",
        });
        settings.bind("group-by-compose-project", groupRow, "active", Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(groupRow);

        const terminalGroup = new Adw.PreferencesGroup({
            title: "Terminal",
            description: "Terminal used for container shells",
        });
        page.add(terminalGroup);

        const terminalModel = Gtk.StringList.new(
            TERMINAL_PROFILES.map((profile) => profile.label),
        );
        const selectedProfile = getEffectiveTerminalProfile(settings);
        const selectedIndex = Math.max(
            0,
            TERMINAL_PROFILES.findIndex((profile) => profile.id === selectedProfile),
        );

        const terminalProfileRow = new Adw.ComboRow({
            title: "Terminal",
            model: terminalModel,
            subtitle: "Choose a terminal preset, or use Custom for your own command",
        });
        terminalProfileRow.set_selected(selectedIndex);
        terminalGroup.add(terminalProfileRow);

        const terminalRow = new Adw.EntryRow({
            title: "Custom terminal command",
        });
        terminalRow.set_text(settings.get_string("terminal"));
        terminalRow.set_visible(selectedProfile === "custom");
        terminalRow.connect("changed", () => {
            settings.set_string("terminal", terminalRow.get_text());
        });
        terminalGroup.add(terminalRow);

        terminalProfileRow.connect("notify::selected", () => {
            const profile = TERMINAL_PROFILES[terminalProfileRow.get_selected()].id;
            settings.set_string("terminal-profile", profile);
            terminalRow.set_visible(profile === "custom");
        });
    }
}
