/**
 * Parse newline-delimited JSON produced by:
 * docker ps -a --format "{{json .}}"
 */
export function parseDockerPsJsonLines(output) {
    if (!output || !output.trim())
        return [];

    const containers = [];
    for (const line of output.trim().split("\n")) {
        if (!line.trim())
            continue;

        try {
            const row = JSON.parse(line);
            const labels = parseLabels(row.Labels ?? "");
            containers.push({
                id: row.ID ?? "",
                name: stripLeadingSlash(row.Names ?? row.Name ?? ""),
                image: row.Image ?? "",
                state: normalizeContainerState(row.State ?? row.Status ?? ""),
                status: row.Status ?? "",
                ports: row.Ports ?? "",
                labels,
                composeProject: labels["com.docker.compose.project"] ?? null,
                composeService: labels["com.docker.compose.service"] ?? null,
            });
        } catch (e) {
            console.error(`[Docker Manager] Failed to parse container line: ${line}`);
            continue;
        }
    }

    return containers;
}

export function parseLabels(labelsText) {
    const labels = {};
    if (!labelsText)
        return labels;

    // Docker labels in JSON are comma-separated: key1=val1,key2=val2
    // But values can contain commas! Logic: A comma followed by something= is a separator.
    const parts = labelsText.split(/,(?=[^,]+=[^,]*)/);
    
    for (const part of parts) {
        const idx = part.indexOf("=");
        if (idx === -1)
            continue;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        if (key)
            labels[key] = value;
    }
    return labels;
}

export function parseDockerStatsJsonLines(output) {
    if (!output || !output.trim())
        return new Map();

    const stats = new Map();
    for (const line of output.trim().split("\n")) {
        if (!line.trim())
            continue;

        try {
            const row = JSON.parse(line);
            const key = row.ID ?? row.Container ?? row.Name;
            if (!key)
                continue;

            stats.set(key, {
                cpu: (row.CPUPerc ?? "0%").replace("%", ""),
                memPerc: (row.MemPerc ?? "0%").replace("%", ""),
                memory: row.MemUsage ?? null,
                network: row.NetIO ?? null,
                block: row.BlockIO ?? null,
            });
        } catch (e) {
            console.error(`[Docker Manager] Failed to parse stats line: ${line}`);
            continue;
        }
    }
    return stats;
}

export function containersChanged(oldContainers, newContainers) {
    if (oldContainers.length !== newContainers.length)
        return true;

    for (let i = 0; i < oldContainers.length; i++) {
        const oldContainer = oldContainers[i];
        const newContainer = newContainers[i];
        if (
            oldContainer.id !== newContainer.id ||
            oldContainer.name !== newContainer.name ||
            oldContainer.state !== newContainer.state ||
            oldContainer.status !== newContainer.status
        ) {
            return true;
        }
    }

    return false;
}

export function getActionsForState(state) {
    switch (state) {
    case "running":
        return [
            { label: "Stop", action: ["stop"] },
            { label: "Restart", action: ["restart"] },
            { label: "Kill", action: ["kill"] },
            { label: "Pause", action: ["pause"] },
        ];
    case "exited":
    case "created":
    case "dead":
        return [
            { label: "Start", action: ["start"] },
            { label: "Remove", action: ["rm"] },
            { label: "Force Remove", action: ["rm", "-f"] },
        ];
    case "paused":
        return [
            { label: "Unpause", action: ["unpause"] },
            { label: "Stop", action: ["stop"] },
            { label: "Kill", action: ["kill"] },
        ];
    case "restarting":
        return [
            { label: "Stop", action: ["stop"] },
            { label: "Kill", action: ["kill"] },
        ];
    default:
        return [];
    }
}

export function getQuickActionForState(state) {
    switch (state) {
    case "running":
        return { label: "Stop", action: ["stop"] };
    case "exited":
    case "created":
        return { label: "Start", action: ["start"] };
    case "paused":
        return { label: "Unpause", action: ["unpause"] };
    default:
        return null;
    }
}

export function normalizeContainerState(value) {
    const text = String(value ?? "").trim().toLowerCase();
    if (!text)
        return "unknown";

    if (text.startsWith("up ") || text === "running" || text.includes("health: starting"))
        return "running";
    if (text.startsWith("exited ") || text === "exited")
        return "exited";
    if (text.includes("paused") || text === "paused")
        return "paused";
    if (text.includes("restarting") || text === "restarting")
        return "restarting";
    if (text === "created")
        return "created";
    if (text === "dead")
        return "dead";

    return text.split(/\s+/)[0];
}

function stripLeadingSlash(name) {
    return String(name ?? "").replace(/^\/+/, "");
}
