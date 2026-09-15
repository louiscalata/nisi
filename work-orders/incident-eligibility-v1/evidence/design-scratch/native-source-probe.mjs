// READ-ONLY probe of the Track 2 native incident source plan shape. In-memory only.
const R='/Users/louiscalata/nisi-next-private/';
const {createPagedIncidentHostFixture}=await import(R+'tests/helpers/incident-review-fixture.mjs');
const {createNativeIncidentSourcePlanV1,readNativeIncidentSourceInputV1,isIssuedNativeIncidentSourcePlanV1,nativeIncidentSourceRefusalV1}=await import(R+'hosts/repository/native-incident-source-v1.mjs');
const {sha256Text,stableStringify}=await import(R+'workflow/contracts.mjs');
const {createRepositoryIncidentPreviewV1}=await import(R+'history/repository-incident-candidates-v1.mjs');
const {issuedSwiftChecksV1}=await import(R+'hosts/swift-verifier/check-plan-v1.mjs');

const H=(part,v)=>sha256Text('nisi/native-incident-'+part+'/v1\0'+stableStringify(v));
const IH=(part,v)=>sha256Text('nisi/repository-incident-'+part+'/v1\0'+stableStringify(v));
const keys=o=>Reflect.ownKeys(o).map(String);
const show=(label,v)=>console.log(label+' = '+JSON.stringify(v));

const {host,preview,eligible}=await createPagedIncidentHostFixture();
console.log('=== HOST + PREVIEW ===');
show('host.status()',host.status());
show('Reflect.ownKeys(host)',keys(host));
show('preview keys',keys(preview));
show('preview.status/schemaVersion/freshness/sourceTrust',[preview.status,preview.schemaVersion,preview.freshness,preview.sourceTrust]);
show('preview.rows.length / eligible.length',[preview.rows.length,eligible.length]);
const row=eligible[0];
console.log('=== ROW (preview row, the "stored failure observation" shape) ===');
show('Reflect.ownKeys(row)',keys(row));
show('row.binding keys',keys(row.binding));
show('row.source keys',keys(row.source));
show('row.subject keys',keys(row.subject));
show('row scalar fields',{schemaVersion:row.schemaVersion,classification:row.classification,reason:row.reason,rawStatus:row.rawStatus,stageStatus:row.stageStatus,disposition:row.disposition,stageIndex:row.stageIndex,failureCodes:row.failureCodes,sourceTrust:row.sourceTrust,persistable:row.persistable,executionVerified:row.executionVerified,learningEligible:row.learningEligible,independentOccurrence:row.independentOccurrence,authorizing:row.authorizing,certificationGranted:row.certificationGranted});
show('row.binding',row.binding);
show('row.subject',row.subject);
show('row.rowId',row.rowId);
show('row.fingerprint',row.fingerprint);
show('row.occurrenceGroupId',row.occurrenceGroupId);
show('row.familyId',row.familyId);
console.log('--- identity recomputation from the candidates module domains ---');
show('rowId === IH(row-id, binding)',row.rowId===IH('row-id',row.binding));
const {fingerprint:_fp,...rowBody}=row;
show('fingerprint === IH(row, rowWithoutFingerprint)',row.fingerprint===IH('row',rowBody));
show('projectId derived from binding',"task:"+row.binding.taskFingerprint);
show('capture entryId would be ric1.+IH(entry-id,{projectId,rowId})','ric1.'+IH('entry-id',{projectId:'task:'+row.binding.taskFingerprint,rowId:row.rowId}));

console.log('=== PLAN (public, source-bound) ===');
const plan=host.nativeIncidentSourcePlan({rowId:row.rowId});
show('Reflect.ownKeys(plan)',keys(plan));
show('plan envelope scalars',{schemaVersion:plan.schemaVersion,status:plan.status,reason:plan.reason,rawContentIncluded:plan.rawContentIncluded,persistable:plan.persistable,freshness:plan.freshness,requiresSeparateAdmission:plan.requiresSeparateAdmission,nativeRerun:plan.nativeRerun,executionVerified:plan.executionVerified,learningEligible:plan.learningEligible,authorizing:plan.authorizing});
show('plan.sourcePlanDigest',plan.sourcePlanDigest);
show('Reflect.ownKeys(plan.selection)',keys(plan.selection));
show('plan.selection.rowId === row.rowId',plan.selection.rowId===row.rowId);
show('plan.selection.rowFingerprint === row.fingerprint',plan.selection.rowFingerprint===row.fingerprint);
show('plan.selection.previewSha256 === preview.sha256',plan.selection.previewSha256===preview.sha256);
show('plan.selection.binding keys',keys(plan.selection.binding));
show('plan.selection.source keys',keys(plan.selection.source));
show('plan.selection.profile',plan.selection.profile);
show('plan.selection.artifactByteLength',plan.selection.artifactByteLength);
show('plan.selection.priorTranscriptSha256',plan.selection.priorTranscriptSha256);
show('plan.selection.inputSha256',plan.selection.inputSha256);
show('stableStringify(plan.selection.binding)===stableStringify(row.binding)',stableStringify(plan.selection.binding)===stableStringify(row.binding));
show('stableStringify(plan.selection.source)===stableStringify(row.source)',stableStringify(plan.selection.source)===stableStringify(row.source));
show('plan.selection.binding !== row.binding (copy)',plan.selection.binding!==row.binding);
show('sourcePlanDigest === H(source-plan, selection)',plan.sourcePlanDigest===H('source-plan',plan.selection));
show('isIssued(plan)',isIssuedNativeIncidentSourcePlanV1(plan));
show('Object.isFrozen plan/selection/binding/profile',[Object.isFrozen(plan),Object.isFrozen(plan.selection),Object.isFrozen(plan.selection.binding),Object.isFrozen(plan.selection.profile)]);
show('plan.selection.subject present?',Object.hasOwn(plan.selection,'subject'));
show('plan.selection.failureCodes present?',Object.hasOwn(plan.selection,'failureCodes'));
show('plan.selection.classification present?',Object.hasOwn(plan.selection,'classification'));
const wire=JSON.stringify(plan);
show('wire contains sources/failure- path?',wire.includes('sources/failure-'));
show('wire contains "content"?',wire.includes('"content"'));

console.log('=== PRIVATE INPUT (accessor, trusted callers) ===');
const input=readNativeIncidentSourceInputV1({plan});
show('Reflect.ownKeys(input)',keys(input));
show('input.schemaVersion',input.schemaVersion);
show('input.artifact keys',keys(input.artifact));
show('input.artifact (content truncated 40)',{relativePath:input.artifact.relativePath,content:input.artifact.content.slice(0,40),sha256:input.artifact.sha256,byteLength:input.artifact.byteLength});
show('input.artifact.sha256 === row.subject.contentSha256',input.artifact.sha256===row.subject.contentSha256);
show('IH(path,relativePath) === row.subject.pathSha256',IH('path',input.artifact.relativePath)===row.subject.pathSha256);
show('input.priorReport keys',keys(input.priorReport));
show('input.priorReport.status',input.priorReport.status);
show('input.priorReport.outcomes',input.priorReport.outcomes);
show('priorTranscriptSha256 === H(prior-transcript, outcomes)',input.priorTranscriptSha256===H('prior-transcript',input.priorReport.outcomes));
const {inputSha256,sourcePlanDigest,...body}=input;
show('inputSha256 === H(source-input, body)',inputSha256===H('source-input',body));
show('input.sourcePlanDigest === plan.sourcePlanDigest',input.sourcePlanDigest===plan.sourcePlanDigest);
show('Object.isFrozen(input)',Object.isFrozen(input));
show('failureCodes in row vs FAIL outcomes in priorReport',[row.failureCodes,input.priorReport.outcomes.filter(o=>o.status==='FAIL').map(o=>o.id)]);

console.log('=== DETERMINISM ===');
const plan2=host.nativeIncidentSourcePlan({rowId:row.rowId});
show('same digest twice',[plan.sourcePlanDigest===plan2.sourcePlanDigest,plan!==plan2]);

console.log('=== REFUSALS ===');
const closed=r=>({status:r.status,reason:r.reason,selection:r.selection,sourcePlanDigest:r.sourcePlanDigest,issued:isIssuedNativeIncidentSourcePlanV1(r),keys:keys(r)});
show('INVALID_INPUT (63-hex)',closed(host.nativeIncidentSourcePlan({rowId:row.rowId.slice(0,63)})));
show('INVALID_INPUT (extra key)',closed(host.nativeIncidentSourcePlan({rowId:row.rowId,extra:1})));
show('INVALID_INPUT (uppercase hex)',closed(host.nativeIncidentSourcePlan({rowId:row.rowId.toUpperCase()})));
show('INVALID_INPUT (null)',closed(host.nativeIncidentSourcePlan(null)));
show('ROW_MISSING (zeros)',closed(host.nativeIncidentSourcePlan({rowId:'0'.repeat(64)})));
show('ROW_MISSING (near-miss last char)',closed(host.nativeIncidentSourcePlan({rowId:row.rowId.slice(0,63)+(row.rowId.at(-1)==='0'?'1':'0')})));
// direct module: cloned preview -> INVALID_PREVIEW; the host method has no such path (uses retained preview).
// Need bundle/context; the host fixture retains them internally, so use collected result of host.settled().
const collected=await host.settled();
show('collected keys',keys(collected));
const ctx={report:collected.report,plans:[],groups:[],executions:[],suite:null,nodeRegistrationFingerprint:null,preparation:null};
show('cloned preview -> ',closed(createNativeIncidentSourcePlanV1({bundle:collected.bundle,context:ctx,preview:structuredClone(preview),rowId:row.rowId})));
show('unknown context (not original) -> ',closed(createNativeIncidentSourcePlanV1({bundle:collected.bundle,context:ctx,preview,rowId:row.rowId})));
show('refusal helper foreign code -> ',closed(nativeIncidentSourceRefusalV1('SOMETHING_ELSE')));
show('refusal helper HOST_NOT_SETTLED -> ',closed(nativeIncidentSourceRefusalV1('HOST_NOT_SETTLED')));
// PASS / non-static rows do not exist in the paging fixture (all FAIL, static only). Report that.
show('classifications in fixture',[...new Set(preview.rows.map(r=>r.classification+'/'+r.binding.stage))]);
console.log('=== SERIALIZED PLAN LOSES AUTHORITY ===');
for(const [n,v] of [['structuredClone',structuredClone(plan)],['JSON',JSON.parse(JSON.stringify(plan))],['spread',{...plan}]]){let err=null;try{readNativeIncidentSourceInputV1({plan:v});}catch(e){err=e.code;}show(n,{issued:isIssuedNativeIncidentSourcePlanV1(v),accessorThrows:err});}
console.log('=== NOT-A-STORED-ROW: plan cannot be resolved from capture entry ids ===');
show('plan has entryId?',Object.hasOwn(plan,'entryId')||Object.hasOwn(plan.selection,'entryId'));
show('plan has projectId?',Object.hasOwn(plan.selection,'projectId'));
show('plan has occurrenceGroupId/familyId?',[Object.hasOwn(plan.selection,'occurrenceGroupId'),Object.hasOwn(plan.selection,'familyId')]);
