import { describe, it } from "node:test";
import assert from "node:assert";
import {
    parseDockerPsJsonLines,
    parseDockerStatsJsonLines,
    parseLabels,
    normalizeContainerState
} from "../src/containerUtils.js";

describe("Docker Advanced Robustness - Labels", () => {
    it("handles labels with commas in values correctly", () => {
        const labelsText = "com.example.desc=Hello, World,version=1.0";
        const labels = parseLabels(labelsText);
        assert.strictEqual(labels["com.example.desc"], "Hello, World");
        assert.strictEqual(labels["version"], "1.0");
    });
});

describe("Docker Advanced Robustness - Stats", () => {
    it("handles non-numeric stats like 'calc' or 'n/a'", () => {
        const output = JSON.stringify({
            ID: "c1",
            CPUPerc: "calc...",
            MemPerc: "n/a",
            MemUsage: "0B / 0B"
        });
        const stats = parseDockerStatsJsonLines(output);
        assert.strictEqual(stats.get("c1").cpu, "calc...");
    });
});

describe("Docker Advanced Robustness - Container States", () => {
    it("handles unknown or futuristic container states", () => {
        const state = normalizeContainerState("Haunted (Zombie) 5 seconds ago");
        assert.strictEqual(state, "haunted");
    });
});

describe("Docker Advanced Robustness - Duplicates", () => {
    it("handles duplicate names in stats output", () => {
        const output = [
            JSON.stringify({ ID: "123", Names: "web", CPUPerc: "1%" }),
            JSON.stringify({ ID: "456", Names: "web", CPUPerc: "2%" })
        ].join("\n");
        
        const stats = parseDockerStatsJsonLines(output);
        assert.strictEqual(stats.size, 2);
        assert.strictEqual(stats.get("123").cpu, "1");
        assert.strictEqual(stats.get("456").cpu, "2");
    });
});
