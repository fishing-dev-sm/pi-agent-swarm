import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		hookTimeout: 0,
		include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
		globalSetup: ["./test/vitest.global-setup.ts"],
		pool: "forks",
		setupFiles: ["./test/vitest.setup.ts"],
		testTimeout: 0,
	},
});
