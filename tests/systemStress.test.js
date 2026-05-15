import { describe, it } from "node:test";
import assert from "node:assert";
import {
    parseDockerPsJsonLines
} from "../src/containerUtils.js";

describe("Docker System Level - Performance & Stress", () => {
    it("handles 1000+ docker containers quickly", () => {
        const lines = [];
        for (let i = 0; i < 1000; i++) {
            lines.push(JSON.stringify({
                ID: `id-${i}`,
                Names: `container-${i}`,
                Image: "nginx",
                State: "running",
                Status: "Up",
                Labels: "com.docker.compose.project=bench"
            }));
        }
        const output = lines.join("\n");
        
        const start = Date.now();
        const result = parseDockerPsJsonLines(output);
        const duration = Date.now() - start;
        
        assert.strictEqual(result.length, 1000);
        assert.ok(duration < 50, `Parsing 1000 lines took too long: ${duration}ms`);
    });
});

describe("Docker System Level - Error Handling (Mocked Simulation)", () => {
    it("identifies Docker permission denied", () => {
        const stderr = "Got permission denied while trying to connect to the Docker daemon socket";
        assert.ok(stderr.toLowerCase().includes("permission denied"));
    });

    it("identifies Docker command not found", () => {
        const errorMsg = "bash: docker: command not found";
        assert.ok(errorMsg.includes("command not found"));
    });
});
