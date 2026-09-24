# Package footprint and token use

This comparison was measured on 2026-09-24. It answers two different questions:
how large the distributed package is, and how many model tokens the recorded workflow
used. **Package or repository size does not measure model-token use.** Nisi's
runtime runs in the host; its source files are not sent to a model unless a host
explicitly includes them in a request.

## Public Nisi project size

The [Nisi v0.2.0 release](https://github.com/louiscalata/nisi/releases/tag/v0.2.0)
contains an npm-format archive of **42,439 compressed bytes and 18 files**
(145,018 unpacked file bytes). Its published SHA-256 is
`aa46147005814c4e72aaa87099894552122ebe2bed91dad89a61b61388be3737`;
we downloaded the release asset and independently matched that digest.
The archive has no bundled dependencies, and Nisi declares no runtime npm
dependencies. It is a fixed release artifact; the later benchmark files on
`main` are not in it.

At public `main` commit
[`3cfe3ae`](https://github.com/louiscalata/nisi/commit/3cfe3ae63269c96138ed96e45f36cfa28b059b66),
the source checkout had **118 tracked files totaling 1,194,053 bytes**. That
number includes tests, documentation, examples, and retained benchmark evidence.
It excludes Git history, ignored dependencies, and untracked files. It describes
the pinned checkout, not the release archive or a prompt sent to a model.

## Other products and package sizes

The chart compares one pinned npm-format archive per Node project. It excludes
dependency packages and does not normalize for capabilities or build contents.
Nisi is a bounded coding-workflow library and fixed-demo CLI;
[LangGraph.js](https://github.com/langchain-ai/langgraphjs) is a general
stateful graph runtime, and [Mastra](https://github.com/mastra-ai/mastra/blob/main/packages/core/README.md)
includes agents, workflows, tools, memory, storage, and more. A larger archive
can simply contain more features, source maps, type declarations, or examples.

| Pinned archive | Compressed bytes | Unpacked file bytes | Archive entries |
|---|---:|---:|---:|
| [Nisi v0.2.0](https://github.com/louiscalata/nisi/releases/download/v0.2.0/nisi-0.2.0.tgz) | 42,439 | 145,018 | 18 |
| [`@langchain/langgraph@1.4.17`](https://www.npmjs.com/package/@langchain/langgraph/v/1.4.17) | 1,001,919 | 4,388,647 | 632 |
| [`@mastra/core@1.69.0`](https://www.npmjs.com/package/@mastra/core/v/1.69.0) | 14,587,291 | 67,851,547 | 3,285 |

![Compressed package archive size on a logarithmic byte scale: Nisi 42,439 bytes, LangGraph.js 1,001,919 bytes, Mastra core 14,587,291 bytes. These products have different scope; this is not model-token usage.](charts/package-footprint.svg)

The [pinned measurement manifest](footprint/packages.json) records sources and
integrity values; the [measurement instructions](footprint/README.md) give the
collection commands. This is **distribution footprint**,
not installed size after dependencies, context-window use, task quality, or a
token-efficiency ranking.

These products overlap different parts of Nisi:

| Product | Where it overlaps | Where the public Nisi product differs |
|---|---|---|
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | Host-defined orchestration and stateful workflows | Nisi supplies a fixed coding-specific sequence of authorization, candidate checks, review, bounded repair, and report validation; LangGraph supplies a general graph runtime with persistence and human-in-the-loop mechanisms. |
| [Mastra](https://github.com/mastra-ai/mastra/blob/main/packages/core/README.md) | TypeScript workflows and model/tool integration | Mastra offers a broader agent application platform. Nisi's public CLI runs fixed demonstrations and leaves arbitrary repository integration to the host. |
| [Aider](https://github.com/Aider-AI/aider) | AI-assisted coding with lint/test repair | Aider is a Python end-user coding assistant that works in repositories and [budgets the repository map sent to a model](https://aider.chat/docs/repomap.html). Nisi is a host-integrated workflow layer, and its public CLI does not edit arbitrary repositories. Aider is omitted from this same-ecosystem archive comparison because Python and npm use different packaging and dependency conventions. |

The distinction between each product's role and feature set is an inference from
their linked official documentation and Nisi's published CLI contract. This is
not a feature-completeness ranking or a measured head-to-head outcome.

## What the token evidence shows

In the [retained 12-task local pilot](results/README.md), Nisi and the
handwritten checked loop each met the strict output contract on all 12 tasks
with 18 model calls and six repairs. The loop reported 8,295 tokens; Nisi
reported 8,291. **Four fewer reported tokens, or 0.048% of the loop total, is
not evidence of material token savings.** Their draft and repair request bytes
matched per task. The direct one-shot arm used 4,803 tokens but met the contract
on only 6/12 tasks and had no repair budget, so it is not an equal-success
comparison. The tasks were synthetic and previously exercised, with one local
Gemma endpoint and unmeasured cache behavior.

Nisi exposes an explicit host/workflow boundary and a validated evidence path;
the pilot does not demonstrate token reduction. To establish a token claim,
the [proposed live study](LIVE-STUDY.md) must pair fresh tasks on
the same target repositories, models, context policy, and repair budgets. It
must record the target project's size **and the actual context sent to the
model** for each call, plus input, output, cached, reviewer, and repair tokens.
Compare accepted-task rates and total tokens per externally correct accepted
result; preserve failures and unknown usage. No comparable Nisi-vs-LangGraph,
Mastra, or Aider inference run has been made.
