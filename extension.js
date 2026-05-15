import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import Clutter from "gi://Clutter";
import St from "gi://St";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { DockerIndicator } from "./src/indicator.js";
import { DockerMenu } from "./src/menu.js";
import { getContainers, getContainerStats, runDockerAction, startEventListener, stopEventListener } from "./src/docker.js";
import { containersChanged } from "./src/containerUtils.js";
import { resolveTerminalArgv } from "./src/terminal.js";

export default class DockerManagerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._containers = [];
        this._actionInProgressCount = 0;
        this._indicator = new DockerIndicator(this.path);
        this._indicator.menu.actor.add_style_class_name("docker-menu-container");
        this._menuBuilder = new DockerMenu(this);

        this._panelClickId = this._indicator._box.connect("button-press-event", () => {
            this._buildMenuSafely();
            this._indicator.menu.toggle();
            return Clutter.EVENT_STOP;
        });

        const menuScrollView = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            style_class: "vfade",
            overlay_scrollbars: true,
        });
        const menuBin = this._indicator.menu.actor.bin;
        menuBin.set_child(null);
        menuScrollView.add_child(this._indicator.menu.box);
        menuBin.set_child(menuScrollView);
        this._menuScrollView = menuScrollView;

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._menuOpenId = this._indicator.menu.connect("open-state-changed", (menu, isOpen) => {
            if (isOpen) {
                const monitor = Main.layoutManager.primaryMonitor;
                const maxH = monitor.height - Main.panel.height - 24;
                this._menuScrollView.style = `max-height: ${maxH}px;`;
                this._buildMenuSafely();
            } else {
                // Refresh data when menu closes so indicator is up to date
                this._fetchContainers();
            }
        });

        this._liveTimerId = null;
        this._liveTarget = null;
        
        // Defer initial fetch to avoid blocking GNOME Shell startup
        this._initTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._initTimeoutId = null;
            this._fetchContainers().catch(() => {});
            this._startEventListener();
            this._startPolling(30);
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {
        if (this._initTimeoutId) {
            GLib.source_remove(this._initTimeoutId);
            this._initTimeoutId = null;
        }

        if (this._panelClickId) {
            this._indicator?._box.disconnect(this._panelClickId);
            this._panelClickId = null;
        }

        if (this._menuOpenId) {
            this._indicator?.menu.disconnect(this._menuOpenId);
            this._menuOpenId = null;
        }

        this._stopLiveStats();
        stopEventListener();

        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }

        if (this._eventDebounceId) {
            GLib.source_remove(this._eventDebounceId);
            this._eventDebounceId = null;
        }
        
        this._indicator?.destroy();
        this._indicator = null;
        if (this._menuScrollView) {
            this._menuScrollView.destroy();
            this._menuScrollView = null;
        }
        this._menuBuilder = null;
        this._settings = null;
    }

    get _actionInProgress() {
        return this._actionInProgressCount > 0;
    }

    _startEventListener() {
        startEventListener(() => this._onDockerEvent(), () => this._startPolling(5));
    }

    _startPolling(seconds) {
        if (this._timerId) GLib.source_remove(this._timerId);
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            // Only poll if menu is closed to prevent accidental closing or unnecessary work
            if (!this._indicator.menu.isOpen) {
                this._fetchContainers();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onDockerEvent() {
        if (this._eventDebounceId) GLib.source_remove(this._eventDebounceId);
        this._eventDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._eventDebounceId = null;
            this._fetchContainers();
            return GLib.SOURCE_REMOVE;
        });
    }

    _fetchContainers() {
        const showAll = this._settings.get_boolean("show-all-containers");
        return getContainers(showAll).then(containers => {
            this._lastFetchError = null;
            const changed = containersChanged(this._containers, containers);
            if (changed) {
                this._containers = containers;
                this._needsRebuild = true;
            }
            this._updateIndicator();
            
            // Rebuild only if no action is in progress. 
            // If an action IS in progress, we just marked _needsRebuild = true.
            if (this._needsRebuild && !this._actionInProgress) {
                this._needsRebuild = false;
                this._buildMenuSafely();
            }
            return containers;
        }).catch(err => {
            console.error(`[Docker Manager] Fetch failed: ${err.message}`);
            if (this._lastFetchError !== err.message) {
                this._lastFetchError = err.message;
                Main.notify("Docker Manager", `Failed to fetch containers: ${err.message}`);
            }
            this._showError(err.message);
            throw err;
        });
    }

    _updateIndicator() {
        if (!this._indicator) return;
        const runningCount = this._containers.filter(c => c.state === "running").length;
        const pausedCount = this._containers.filter(c => c.state === "paused").length;
        const dangerCount = this._containers.filter(c => ["dead", "restarting"].includes(c.state)).length;
        this._indicator.update(runningCount, this._containers.length, pausedCount > 0, dangerCount > 0);
    }

    _buildMenuSafely() {
        try { 
            this._menuBuilder.build(); 
        } catch (e) { 
            console.error(`[Docker Manager] Build failed: ${e.message}`);
            this._showError(e.message); 
        }
    }

    _runAction(action, containerId, skipRefresh = false) {
        this._actionInProgressCount++;
        const args = Array.isArray(action) ? [...action, containerId] : [action, containerId];
        return runDockerAction(...args)
            .then(() => {
                if (!skipRefresh) return this._fetchContainers();
                return null;
            })
            .catch(err => {
                console.error(`[Docker Manager] Action failed: ${err.message}`);
                Main.notify("Docker Manager", `Action failed: ${err.message}`);
                throw err;
            })
            .finally(() => {
                this._actionInProgressCount--;
            });
    }

    /**
     * Poll until all specified containers reach the target state or timeout (30s).
     */
    async waitForContainersState(containerIds, targetState) {
        const start = Date.now();
        const timeout = 30000; 

        while (Date.now() - start < timeout) {
            const containers = await getContainers(true);
            const allMatch = containerIds.every(id => {
                const c = containers.find(item => item.id === id);
                if (!c) return targetState === "exited";
                if (targetState === "exited") return c.state !== "running" && c.state !== "restarting";
                return c.state === targetState;
            });

            if (allMatch) {
                // For 'Start', wait an extra second so Docker stats settle and UI feels better
                if (targetState === "running") {
                    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => { r(); return GLib.SOURCE_REMOVE; }));
                }
                return true;
            }
            
            await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => { r(); return GLib.SOURCE_REMOVE; }));
        }
        throw new Error("Timeout waiting for containers to change state");
    }

    _startLiveStats(container, statsItem) {
        this._stopLiveStats();
        this._liveTarget = { container, statsItem };
        this._doLiveUpdate();
        this._liveTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3, () => {
            this._doLiveUpdate();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopLiveStats() {
        if (this._liveTimerId) { GLib.source_remove(this._liveTimerId); this._liveTimerId = null; }
        this._liveTarget = null;
    }

    _doLiveUpdate() {
        if (!this._liveTarget) return;
        getContainerStats(this._liveTarget.container.id).then(stats => {
            if (!this._liveTarget) return;
            this._liveTarget.statsItem.label.text = `Stats: CPU ${stats.cpu}% / RAM ${stats.memory}`;
        }).catch(() => {});
    }

    _openShell(container) {
        try {
            const argv = resolveTerminalArgv(this._settings, ["docker", "exec", "-it", container.id, "sh"]);
            Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
            this._indicator.menu.close();
        } catch (e) { Main.notify("Docker Manager", `Failed to open shell: ${e.message}`); }
    }

    _showError(message) {
        if (!this._indicator) return;
        const menu = this._indicator.menu;
        menu.removeAll();
        const item = new PopupMenu.PopupMenuItem(`Error: ${message}`, { reactive: false });
        item.label.clutter_text.line_wrap = true;
        menu.addMenuItem(item);
    }
}
