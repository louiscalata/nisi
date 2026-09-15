# Private operator-facing repository history review

Overall Nisi30% (3/10); scoped implementation/acceptance complete. See roadmap.md.

## Actual consumer and unchanged boundaries

Wire optional --review-history into examples/repository-live-model.mjs immediately
after successful collectLiveHostEvidenceV1 and before live-run receipt creation.
Default CLI behavior/summary and existing parseLiveDemoArguments stay unchanged.
New parseLiveDemoInvocation(args) returns frozen {selected,reviewHistory}; strips
one bare --review-history token then delegates legacy/V3 parsing unchanged. Reject
duplicates, equals form, sparse/non-string args, or --help combined with review.
The new flag only requests review, NEVER approves storage. Help describes it.
Require actual stdin/stdout TTY before fixture/model/compiler startup when flag
is requested; reject LIVE_HISTORY_TTY_REQUIRED otherwise. Standalone help inert.

After settlement call reviewRepositoryHistoryV1, using actual host, owned run
directory, Date.now, existing CLI AbortSignal, real terminal prompt and existing
journal opener. New summary key historyReview only if flag present (null if review
not reached). Existing live receipt, exit criteria, reportStored and host state
stay unchanged. History outcome is an additional result, never a model-success
or durability upgrade. No approval answer or preview is separately retained.
Existing demo raw run evidence retention remains unchanged and must be disclosed.

## Review API: hosts/history/review-repository-history-v1.mjs

Export async reviewRepositoryHistoryV1(input), exact own-data envelope:
{host,runDirectory,clock,prompt,openOwner,signal,promptTimeoutMs}.
host is trusted object with historyPreview/captureHistory methods. Clock trusted
sync integer epoch-ms callback. prompt/openOwner trusted callbacks. Signal native
AbortSignal or null, checked with native aborted getter, not override property.
runDirectory absolute non-root wellformed string<=4096,noNUL. timeout integer1..120000.
Fixed destination path.join(runDirectory,'history-journal.jsonl'). No arbitrary
file selection, mkdir, native execution, model calls, shell, file deletion or owner
close API invented. Actual journal owner has no persistent fd/close method.

Result frozen exact fields {schemaVersion:'nisi-repository-history-review/v1',
status,reason,sourceDigest,ownerOpenAttempted,captureCallAttempted,capture,
cancelledAfterCaptureCall,authorizing:false}. Initially digest/capture:null, booleans
false. Pre-capture outcome NOT_STORED with bounded reason. Invalid input INVALID_INPUT;
overlapping review of same host REVIEW_BUSY. Module WeakSet guarded before callbacks
and released finally. A completed declined review may be attempted again explicitly;
the underlying host still enforces one record attempt, not reusable consent.

Preview: call actual host, clone/freeze own-data result; envelope exact6 keys and
schema/status PREVIEW/reason:null, authorizing:false. Validate body schema and fixed
19 keys, false attestation/learning/authority flags, taskFingerprint hex64; max16384
canonical UTF8 bytes. Recompute SHA256('nisi/repository-history-preview/v1\0'+
stableStringify(body)), compare hex64 p.sha256. This is trusted-host metadata,
not independent report validation, source attestation or hostile-JS isolation.
Non-PREVIEW -> PREVIEW_UNAVAILABLE; malformed/digest mismatch -> PREVIEW_INVALID.
No projected raw strings outside body, no malformed callback output echoed.

Prompt receives frozen {text,expectedAnswer,signal,timeoutMs}. Inner AbortSignal is
owned by review. text shows escaped fixed metadata, full digest and JSON-escaped
destination, declared14day retention with NO automatic sweeper, hashes linkable
not anonymous, no learning/publication, NOT authenticated consent, and existing
demo raw run evidence ALREADY retained. Escape all controls/ANSI and bidi marks
in string values, not layout newlines. expectedAnswer='STORE '+sourceDigest.
Prompt returns exact {kind:'answer',text:string} or {kind:'eof'|'timeout'|'no-tty'|
'signal'|'error'}. Review parses raw answer, NO trim/case/whitespace normalization.
Empty/no/n -> DECLINED; all other non-exact -> ANSWER_MISMATCH. No answer echoed.
Other kinds -> EOF,TIMEOUT,NO_TTY,ABORTED,PROMPT_ERROR; throw/malformed -> PROMPT_ERROR.

Review owns an at-most120s timer/race and native abort subscription; deadline
result cannot accept late answer. Always abort inner prompt signal and remove
only owned listeners/timer. Capture/check native cancellation after every supplied
callback and async result; synthetic abort events must not count, suppressed abort
listeners must not permit capture (native getter check). Prompt is trusted and
cooperatively cleans its own input handles on inner abort; no claim arbitrary
noncooperative callback code is stopped. No fs/openOwner before exact positive answer.

After positive answer, re-read/copy preview; require identical digest or DIGEST_CHANGED.
Read valid wall clock, mint declaration NOW (not at prompt start): issuedAt/createdAt
now, expiresAt now+60000, retentionMs1209600000 (14days), overflow refused INVALID_CLOCK.
Actual declaration schema MUST be the existing thirteen-key closed shape:
schemaVersion:'nisi-repository-history-declaration/v1',declarationId:'cli-history.'+UUID,
projectId:'task:'+body.taskFingerprint,sourceDigest,issuedAt,expiresAt,createdAt,
retentionMs,consentClass:'WRITTEN_DECLARATION',destination:'LOCAL_OBSERVATION_JOURNAL_ONLY',
rawContentPersisted:false,networkEgress:false,learningInfluence:false.
Do not insert invented text/actor/authenticated fields or ISO dates into that schema.

openOwner receives frozen {path,config,now}, config={projectId,maxEntries:32,
heartbeatTtlMs:30000,redactPaths:[]}; it is synchronous and returns the actual
openJournalOwner response. Set ownerOpenAttempted before callback; valid OPENED
required, otherwise OPEN_FAILED (no raw result echoed). Check cancellation after it.
Pass wrapped clock to actual captureHistory; wrapper checks real abort before and
after each clock callback, throwing to prevent admission. Final capture API still
decides exact temporal reasons and one-attempt consumption. Set captureCallAttempted
BEFORE invoking it. Returned capture result preserved exactly; outer status/reason
match known frozen capture envelope. cancelledAfterCaptureCall reflects native
signal after return, never replaces a real capture with unattempted cancellation.
Unexpected capture throw/invalid result -> UNCERTAIN/CAPTURE_UNCONFIRMED,capture:null;
do not invent recordAttempted/consumed booleans when no valid capture was returned.

## Terminal adapter: hosts/history/terminal-history-prompt-v1.mjs

Export promptRepositoryHistoryV1({text,expectedAnswer,signal,timeoutMs,input,output}).
Default actual streams may be supplied by CLI, no import-time IO. NO_TTY returns
without writes/listeners. Use bounded line input <=1024 UTF8 bytes. Remove LF or
CRLF line delimiter only, not other whitespace; unexpected trailing pasted lines
in the same delivered chunk must not be accepted as a valid single answer. Future
chunks after a completed line cannot be predicted. Oversize/multiple-line input
returns kind:error; literal Ctrl-C returns kind:signal. Return raw outcome; never boolean
approval. Handle EOF, errors, abort, Ctrl-C and timeout; cleanup only owned listeners
and timer. Preserve only streams already readableFlowing:true; release input this
adapter started, including fresh readableFlowing:null (isPaused()false). No process signal handler
overrides; existing CLI AbortSignal handles SIGINT/SIGTERM. Must not keep stdin
resumed after completion if it was paused before prompt. Never persist input.

## Acceptance

Independent pre-implementation oracle for review+terminal+CLI parser. Positive
actual host+actual journal capture; delayed prompt, digest drift, decline, timeout,
EOF, nonTTY, malformed/getters, abort-before/while/after capture and clock overrides;
no owner open on refused review; exact declaration; prompt escaping/warnings;
stable original reports. Prove CLI actual run path invokes review only after
settlement through source-relocated trusted fixed dependencies, no model/Swift
execution. Retain existing parser fixtures and default summary behavior. Additive
history type contract is a disjoint task. Full portable checks and source pins;
manual live TTY/new native acceptance remain NOT_RUN until separately exercised.
