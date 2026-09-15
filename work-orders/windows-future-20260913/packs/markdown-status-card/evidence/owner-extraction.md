# Owner provenance correction and final source

The earlier owner-extraction record was inaccurate: the reviewer installed a
rewritten implementation, not the exact decoded worker source. It is preserved
in owner-extraction-superseded.md; that variant is retained as luna-rewrite.mjs.
Its passing verification.json and stdout files describe that variant only.

Root decoded the original complete JSON response, read the entire source, and
confirmed the worker version itself emits real LF bytes and escapes backslashes.
A direct pure-function probe observed 5 LF characters, no literal backslash-n,
and the required &#x5C; entity. The initial suspected escape defect was not reproduced.
Root restored precisely the decoded worker source plus one terminal LF; no logic
correction was needed. Final SHA-256:
9ea91d273de854cead45fe91c7a5a4580b02419b14398ce3ff3e392943fef4ae.

The final source passed baseline 2/2 and acceptance 10/10 in separate real runs.
See owner-verification-final.json and the queue batch verification for current evidence.
All original protected tests/package/request/packet pins remain unchanged.
Independent Windows review remains unavailable; this is not owner acceptance.
