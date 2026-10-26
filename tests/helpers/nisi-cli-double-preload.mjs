// Test-only loader configuration. Never used by the production command.
import { register } from 'node:module';
register(new URL('./nisi-cli-double-loader.mjs', import.meta.url), {
  data: { mode: process.env.NISI_CLI_TEST_MODE },
});
