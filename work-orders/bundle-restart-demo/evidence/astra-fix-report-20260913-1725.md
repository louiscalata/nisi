Applied the fix only to `src/bundle-restart-demo.mjs`. The validation line also needs `path.endsWith(sep)` because Node’s `normalize()` preserves trailing slashes; without that guard, test 8 still failed.

```diff
--- a/src/bundle-restart-demo.mjs
+++ b/src/bundle-restart-demo.mjs
@@ -1,6 +1,6 @@
 import { openJournalBundle, recordFixedRun } from '../frozen/host-journal-bundle.mjs';
 import * as fs from 'node:fs';
-import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
+import { basename, dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
 import { fileURLToPath } from 'node:url';
 
 const scratch = join(dirname(dirname(fileURLToPath(import.meta.url))), '.scratch');
@@ -18,12 +18,12 @@
 
   const path = input.path;
   if (typeof path !== 'string' || path.length === 0 || path.includes('\0')
-    || !isAbsolute(path) || basename(path) !== 'journal.jsonl') return false;
+    || !isAbsolute(path) || path !== normalize(path) || path.endsWith(sep) || basename(path) !== 'journal.jsonl') return false;
 
   const parent = dirname(path);
   if (!fs.lstatSync(parent).isDirectory()) return false;
-  const owned = fs.realpathSync(scratch);
-  const resolvedParent = fs.realpathSync(parent);
+  const owned = fs.realpathSync.native(scratch);
+  const resolvedParent = fs.realpathSync.native(parent);
   const within = relative(owned, resolvedParent);
   if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) return false;
 
```

Module SHA-256:

```text
1296d7ba1a7c7951019c9bd96103601bd2dfd98e5aa3132f4529637ab1f15985
```

Final verification:

- `npm test`: **3/3 passed**, 0 failures.
- `npm run test:demo`: **9/9 passed**, 0 failures.

The file-hash comparison confirmed that the module was the only existing file changed. The tests created their fixtures under `.scratch/`. No commit, push, model load, or packet run was performed.