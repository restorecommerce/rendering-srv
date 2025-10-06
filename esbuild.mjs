import * as esbuild from 'esbuild'
import { commonifierPlugin } from '@restorecommerce/dev'

await esbuild.build({
  entryPoints: ['./src/start.ts'],
  bundle: true,
  platform: 'node',
  outfile: 'lib/start.cjs',
  minify: true,
  treeShaking: true,
  sourcemap: 'linked',
  plugins: [commonifierPlugin],
});
