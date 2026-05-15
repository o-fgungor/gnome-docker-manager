import Gio from "gi://Gio";
import GLib from "gi://GLib";
import {
    parseDockerPsJsonLines,
    parseDockerStatsJsonLines,
} from "./containerUtils.js";

let _eventProc = null;
let _eventCancellable = null;

function runDocker(args) {
    return new Promise((resolve, reject) => {
        try {
            const proc = Gio.Subprocess.new(
                ["docker", ...args],
                Gio.SubprocessFlags.STDOUT_PIPE |
                    Gio.SubprocessFlags.STDERR_PIPE,
            );

            proc.communicate_utf8_async(null, null, (_proc, res) => {
                try {
                    const [, stdout, stderr] =
                        _proc.communicate_utf8_finish(res);

                    if (!_proc.get_successful()) {
                        const cmd = `docker ${args.join(" ")}`;
                        reject(new Error(`${cmd} failed: ${stderr.trim() || "unknown error"}`));
                        return;
                    }

                    resolve(stdout);
                } catch (e) {
                    reject(e);
                }
            });
        } catch (e) {
            reject(e);
        }
    });
}

export async function getContainers(showAll = true) {
    const args = showAll
        ? ["ps", "-a", "--format", "{{json .}}"]
        : ["ps", "--format", "{{json .}}"];

    return parseDockerPsJsonLines(await runDocker(args));
}

export function runDockerAction(...args) {
    return runDocker(args);
}

export async function getContainerStats(containerId) {
    const output = await runDocker([
        "stats",
        "--no-stream",
        "--format",
        "{{json .}}",
        containerId,
    ]);
    const stats = parseDockerStatsJsonLines(output);
    return stats.get(containerId) ?? [...stats.values()][0] ?? {};
}

export function startEventListener(onEvent, onDied) {
    stopEventListener();

    _eventCancellable = new Gio.Cancellable();

    _eventProc = Gio.Subprocess.new(
        ["docker", "events", "--format", "{{json .}}"],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    );

    const stdout = new Gio.DataInputStream({
        base_stream: _eventProc.get_stdout_pipe(),
    });

    const readLine = () => {
        stdout.read_line_async(
            GLib.PRIORITY_DEFAULT,
            _eventCancellable,
            (stream, res) => {
                try {
                    const [line] = stream.read_line_finish_utf8(res);
                    if (line !== null) {
                        onEvent(line);
                        readLine();
                    } else if (onDied) {
                        onDied();
                    }
                } catch (_e) {
                    // Cancelled during extension shutdown.
                }
            },
        );
    };

    readLine();
}

export function stopEventListener() {
    if (_eventCancellable) {
        _eventCancellable.cancel();
        _eventCancellable = null;
    }
    if (_eventProc) {
        try {
            _eventProc.force_exit();
        } catch (_e) {
            // Already dead.
        }
        _eventProc = null;
    }
}
