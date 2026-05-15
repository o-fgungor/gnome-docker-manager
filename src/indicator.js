import Gio from "gi://Gio";
import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

export const DockerIndicator = GObject.registerClass(
class DockerIndicator extends PanelMenu.Button {
    _init(extensionPath) {
        super._init(0.5, "Docker Manager", false);

        this._box = new St.BoxLayout({
            style_class: "panel-status-indicators-box",
            reactive: true,
            can_focus: true,
            track_hover: true,
        });

        let gicon = null;
        if (extensionPath) {
            const iconFile = Gio.File.new_for_path(`${extensionPath}/src/icons/docker-symbolic.svg`);
            gicon = Gio.FileIcon.new(iconFile);
        }

        const iconConfig = {
            style_class: "system-status-icon",
            icon_size: 18,
        };

        if (gicon) {
            iconConfig.gicon = gicon;
        } else {
            iconConfig.icon_name = "application-x-executable-symbolic";
        }

        this._icon = new St.Icon(iconConfig);

        this._label = new St.Label({
            text: "",
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        this.add_child(this._box);
    }

    update(runningCount, totalCount, hasPaused, hasDanger) {
        this._label.text = totalCount > 0 ? ` ${runningCount}/${totalCount}` : "";

        this._icon.remove_style_class_name("docker-panel-icon-danger");
        this._icon.remove_style_class_name("docker-panel-icon-warning");
        this._icon.remove_style_class_name("docker-panel-icon-running");

        if (hasDanger)
            this._icon.add_style_class_name("docker-panel-icon-danger");
        else if (hasPaused)
            this._icon.add_style_class_name("docker-panel-icon-warning");
        else if (runningCount > 0)
            this._icon.add_style_class_name("docker-panel-icon-running");
    }
});
