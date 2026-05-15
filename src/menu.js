import * as Main from "resource:///org/gnome/shell/ui/main.js";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Pango from "gi://Pango";
import GLib from "gi://GLib";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { getActionsForState, getQuickActionForState } from "./containerUtils.js";

export class DockerMenu {
    constructor(extension) {
        this._ext = extension;
        this._bulkActionResetters = [];
        this._bgClickId = null;
    }

    build() {
        this._ext._stopLiveStats();
        this._bulkActionResetters = [];
        const menu = this._ext._indicator.menu;
        menu.removeAll();

        if (!this._bgClickId) {
            menu.box.reactive = true;
            this._bgClickId = menu.box.connect("button-press-event", () => {
                this.resetBulkActions();
                return Clutter.EVENT_PROPAGATE;
            });
        }

        if (this._ext._containers.length === 0) {
            menu.addMenuItem(new PopupMenu.PopupMenuItem("No containers found", { reactive: false }));
            return;
        }

        const grouped = this._ext._settings.get_boolean("group-by-compose-project");
        if (grouped) this._buildGroupedMenu(menu);
        else this._buildFlatMenu(menu, this._ext._containers);

        this._addBulkActions(menu);
    }

    resetBulkActions() {
        this._bulkActionResetters.forEach(reset => reset());
    }

    _buildGroupedMenu(menu) {
        const groups = new Map();
        const loose = [];
        for (const c of this._ext._containers) {
            if (c.composeProject) {
                if (!groups.has(c.composeProject)) groups.set(c.composeProject, []);
                groups.get(c.composeProject).push(c);
            } else { loose.push(c); }
        }
        for (const [project, containers] of groups) {
            menu.addMenuItem(new PopupMenu.PopupMenuItem(project, { reactive: false }));
            this._buildFlatMenu(menu, containers);
            this._addBulkActions(menu, project, containers);
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }
        if (loose.length > 0) {
            menu.addMenuItem(new PopupMenu.PopupMenuItem("Other Containers", { reactive: false }));
            this._buildFlatMenu(menu, loose);
            this._addBulkActions(menu, "Other", loose);
            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }
    }

    _buildFlatMenu(menu, containers) {
        const running = containers.filter(c => c.state === "running");
        const others = containers.filter(c => c.state !== "running");
        for (const c of running) this._addContainerMenuItem(menu, c);
        for (const c of others) this._addContainerMenuItem(menu, c);
    }

    _addBulkActions(menu, projectName = "", containers = this._ext._containers) {
        const stopped = containers.filter(c => c.state !== "running");
        const running = containers.filter(c => c.state === "running");
        const isGlobal = projectName === "";
        if (containers.length === 0) return;
        if (isGlobal) menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const row = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        const box = new St.BoxLayout({ x_expand: true, x_align: Clutter.ActorAlign.CENTER, style: "spacing: 12px; padding: 4px 0;" });

        const makeBtn = (text, onClick) => {
            const btn = new St.Button({ style_class: "popup-menu-item container-submenu-button", x_expand: true, can_focus: true });
            btn.set_child(new St.Label({ text, x_align: Clutter.ActorAlign.CENTER }));

            let confirmed = false;
            let loading = false;

            const resetBtn = () => {
                confirmed = false;
                btn.get_child().text = text;
                btn.remove_style_class_name("confirm-start-all");
                btn.remove_style_class_name("confirm-stop-all");
                btn.reactive = true;
            };
            this._bulkActionResetters.push(resetBtn);

            btn.connect("clicked", () => {
                if (loading) return;
                
                if (!confirmed) {
                    // Reset others before confirming this one
                    this.resetBulkActions();
                    confirmed = true;
                    btn.get_child().text = "Are you sure?";
                    btn.add_style_class_name(text.startsWith("Start") ? "confirm-start-all" : "confirm-stop-all");
                    return;
                }

                loading = true;
                const originalText = text;
                const actionVerb = originalText.startsWith("Start") ? "Starting" : "Stopping";
                btn.get_child().text = `${actionVerb}...`;
                btn.reactive = false; 
                
                onClick().then(() => {
                    btn.get_child().text = "Done!";
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                        if (btn.get_child()) {
                            resetBtn();
                            loading = false;
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }).catch(err => {
                    btn.get_child().text = "Failed!";
                    btn.reactive = true;
                    loading = false;
                    confirmed = false;
                });
            });

            const menuId = this._ext._indicator.menu.connect("open-state-changed", (m, isOpen) => {
                if (!isOpen && !loading) resetBtn();
            });
            btn.connect("destroy", () => this._ext._indicator.menu.disconnect(menuId));
            return btn;
        };

        if (stopped.length > 0) box.add_child(makeBtn(isGlobal ? "Start All" : "Start Group", () => {
            const ids = stopped.map(c => c.id);
            this._ext._actionInProgressCount++;
            return Promise.all(ids.map(id => this._ext._runAction("start", id, true)))
                .then(() => this._ext.waitForContainersState(ids, "running"))
                .finally(() => { 
                    this._ext._actionInProgressCount--; 
                    this._ext._fetchContainers();
                });
        }));
        if (running.length > 0) box.add_child(makeBtn(isGlobal ? "Stop All" : "Stop Group", () => {
            const ids = running.map(c => c.id);
            this._ext._actionInProgressCount++;
            return Promise.all(ids.map(id => this._ext._runAction("stop", id, true)))
                .then(() => this._ext.waitForContainersState(ids, "exited"))
                .finally(() => { 
                    this._ext._actionInProgressCount--; 
                    this._ext._fetchContainers();
                });
        }));

        row.add_child(box);
        menu.addMenuItem(row);
    }

    _addContainerMenuItem(menu, container) {
        const isRunning = container.state === "running";
        const stateClass = this._getStateClass(container.state);
        const quickAction = getQuickActionForState(container.state);
        const item = new PopupMenu.PopupSubMenuMenuItem("");
        item.add_style_class_name("container-toggle-item");
        menu.addMenuItem(item);
        item.reactive = false;
        item.remove_all_children();

        const toggleRow = new St.BoxLayout({ style_class: "container-toggle-row quick-menu-toggle", x_expand: true, y_align: Clutter.ActorAlign.CENTER });
        const mainBtn = new St.Button({ style_class: `quick-toggle button ${stateClass}`, x_expand: true, can_focus: true });
        if (isRunning) mainBtn.add_style_pseudo_class("checked");
        if (quickAction) mainBtn.add_style_class_name("container-has-quick-action");
        
        const mainContent = new St.BoxLayout({ x_expand: true, style_class: "container-main-content" });
        
        const disclosureIcon = new St.Icon({ icon_name: "pan-end-symbolic", icon_size: 14, style_class: "container-disclosure-icon" });
        disclosureIcon.set_pivot_point(0.5, 0.5);
        mainContent.add_child(disclosureIcon);

        const nameLabel = new St.Label({ 
            text: container.name, 
            style_class: "container-name-label", 
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true
        });
        nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        nameLabel.clutter_text.width_chars = 18; 
        mainContent.add_child(nameLabel);
        
        mainBtn.set_child(mainContent);
        mainBtn.connect("clicked", () => item.menu.toggle());
        toggleRow.add_child(mainBtn);

        if (quickAction) {
            const actionBtn = new St.Button({ style_class: `container-quick-action quick-toggle button ${stateClass}`, label: quickAction.label, can_focus: true });
            if (isRunning) actionBtn.add_style_pseudo_class("checked");
            actionBtn.connect("clicked", () => this._ext._runAction(quickAction.action, container.id));
            toggleRow.add_child(actionBtn);
        }
        item.add_child(toggleRow);

        const submenu = item.menu;
        submenu.actor.add_style_class_name("container-submenu");
        submenu.addMenuItem(this._createDetailItem(`Image: ${container.image}`));
        submenu.addMenuItem(this._createDetailItem(`Status: ${container.status}`));
        let statsItem = null;
        if (isRunning) { statsItem = this._createDetailItem("Stats: -"); submenu.addMenuItem(statsItem); }
        submenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (isRunning) submenu.addMenuItem(this._createActionButton("Shell", () => this._ext._openShell(container)));
        for (const { label, action } of getActionsForState(container.state))
            submenu.addMenuItem(this._createActionButton(label, () => this._ext._runAction(action, container.id)));

        submenu.connect("open-state-changed", (m, isOpen) => {
            disclosureIcon.ease({ rotation_angle_z: isOpen ? 90 : 0, duration: 140 });
            if (isOpen) {
                this.resetBulkActions();
                if (statsItem) this._ext._startLiveStats(container, statsItem);
            } else {
                this._ext._stopLiveStats();
            }
        });
    }

    _createDetailItem(text) {
        const item = new PopupMenu.PopupMenuItem(text, { reactive: false });
        item.add_style_class_name("container-detail-item");
        
        const label = item.label.clutter_text;
        label.ellipsize = Pango.EllipsizeMode.NONE;
        label.line_wrap = true;
        
        item.label.x_expand = true;
        label.width = 10; 

        return item;
    }

    _createActionButton(label, onClick) {
        const item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
        item.add_style_class_name("container-action-item");
        const button = new St.Button({ style_class: "popup-menu-item container-submenu-button", x_expand: true, can_focus: true });
        button.set_child(new St.Label({ text: label, style_class: "container-submenu-button-label" }));
        button.connect("clicked", onClick);
        item.add_child(button);
        return item;
    }

    _getStateClass(state) {
        switch (state) {
            case "running": return "container-running";
            case "paused": return "container-paused";
            case "restarting": return "container-restarting";
            case "dead": return "container-dead";
            default: return "container-stopped";
        }
    }
}
