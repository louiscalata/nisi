export { createCandidate, createTaskSpecification, RUN_OUTCOMES, sha256Text } from './workflow.js';
import type { Candidate, CandidateInput, TaskSpecification, Finding, DeepReadonly } from './workflow.js';
export const WORKFLOW_SCHEMA_VERSION: 1;
export const CANDIDATE_SCHEMA_VERSION: 1;
export const TASK_MODES: readonly ['edit', 'review'];
export const ADAPTER_STATUSES: readonly ['PASS', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'];
export const REPAIR_STATUSES: readonly ['REPAIRED', 'NO_CHANGE', 'FAIL', 'NOT_RUN', 'UNAVAILABLE'];
export class WorkflowInputError extends Error { constructor(code: string); code: string }
/** Unsupported values throw; TypeScript cannot establish plain-data shape or acyclicity. */
export function cloneFreeze<T>(value: T): DeepReadonly<T>;
export function stableStringify(value: unknown): string;
export function freezeReport<T>(value: T): DeepReadonly<T>;
export function validateCandidateForTask(candidate: CandidateInput, task: TaskSpecification, authorId: string): Candidate;
export function validateFindings<T extends readonly Finding[]>(findings: T, stage: string): T;
export function validateAdapterIdentity(adapter: { readonly id: string }, label: string): string;
