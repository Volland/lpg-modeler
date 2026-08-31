import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The extension host entry imports 'vscode', which only exists inside the editor.
  // Tests run it against a stub so the commands can be driven end to end.
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./packages/vscode/test/vscode.stub.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 30000,
  },
})
