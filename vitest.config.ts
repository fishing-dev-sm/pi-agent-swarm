import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// Preserve the old compiled-suite behavior by resolving the shared Kit from the root workspace.
		alias: [
			{
				find: "@narumitw/pi-tui-kit/testing",
				replacement: fileURLToPath(
					new URL("./packages/pi-tui-kit/dist/testing/index.js", import.meta.url),
				),
			},
			{
				find: "@narumitw/pi-tui-kit",
				replacement: fileURLToPath(new URL("./packages/pi-tui-kit/dist/index.js", import.meta.url)),
			},
		],
	},
	test: {
		environment: "node",
		hookTimeout: 0,
		include: ["test/**/*.test.ts", "packages/*/test/**/*.test.ts"],
		pool: "forks",
		setupFiles: ["./test/vitest.setup.ts"],
		testTimeout: 0,
	},
});
