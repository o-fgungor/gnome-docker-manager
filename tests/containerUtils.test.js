import { describe, it } from "node:test";
import assert from "node:assert";
import {
    parseDockerPsJsonLines,
    parseDockerStatsJsonLines,
    containersChanged,
    getActionsForState,
    getQuickActionForState,
    normalizeContainerState,
} from "../src/containerUtils.js";

describe("parseDockerPsJsonLines", () => {
    it("parses valid docker ps JSON", () => {
        const output = JSON.stringify({
            ID: "abc123",
            Names: "web",
            Image: "nginx",
            State: "running",
            Status: "Up",
            Labels: "com.docker.compose.project=site,com.docker.compose.service=web"
        });
        const result = parseDockerPsJsonLines(output);
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].id, "abc123");
        assert.strictEqual(result[0].composeProject, "site");
    });

    it("handles malformed JSON lines safely", () => {
        const output = '{"ID":"123"}\nINVALID_JSON\n{"ID":"456"}';
        const result = parseDockerPsJsonLines(output);
        assert.strictEqual(result.length, 2);
        assert.strictEqual(result[0].id, "123");
        assert.strictEqual(result[1].id, "456");
    });

    it("handles missing optional fields", () => {
        const output = JSON.stringify({ ID: "123" });
        const result = parseDockerPsJsonLines(output);
        assert.strictEqual(result[0].name, "");
        assert.strictEqual(result[0].state, "unknown");
    });
});

describe("parseDockerStatsJsonLines", () => {
    it("parses valid stats", () => {
        const output = JSON.stringify({ ID: "c1", CPUPerc: "1.5%", MemPerc: "2%" });
        const stats = parseDockerStatsJsonLines(output);
        assert.strictEqual(stats.get("c1").cpu, "1.5");
    });

    it("handles missing stats data (---)", () => {
        const output = JSON.stringify({ ID: "c1", CPUPerc: "--", MemPerc: "--" });
        const stats = parseDockerStatsJsonLines(output);
        assert.strictEqual(stats.get("c1").cpu, "--");
    });

    it("handles corrupt stats JSON safely", () => {
        const output = "corrupt_data";
        const stats = parseDockerStatsJsonLines(output);
        assert.strictEqual(stats.size, 0);
    });
});

describe("normalizeContainerState", () => {
    it("handles various status strings", () => {
        assert.strictEqual(normalizeContainerState("Up 5m"), "running");
        assert.strictEqual(normalizeContainerState("Exited (0)"), "exited");
        assert.strictEqual(normalizeContainerState("Health: starting"), "running");
        assert.strictEqual(normalizeContainerState(null), "unknown");
        assert.strictEqual(normalizeContainerState(""), "unknown");
    });
});

describe("getActionsForState", () => {
    it("returns correct action arrays", () => {
        const actions = getActionsForState("running");
        assert.ok(Array.isArray(actions[0].action));
        assert.strictEqual(actions[0].action[0], "stop");
    });
});

describe("containersChanged", () => {
    it("detects changes correctly", () => {
        const c1 = [{ id: "1", state: "running" }];
        const c2 = [{ id: "1", state: "exited" }];
        assert.strictEqual(containersChanged(c1, c2), true);
        assert.strictEqual(containersChanged(c1, c1), false);
    });
});
