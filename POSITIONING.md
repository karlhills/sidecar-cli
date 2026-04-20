# Sidecar — Positioning

**One sentence:** Sidecar is the local memory layer that turns a folder full of
scattered tasks, prompts, and runs into context an AI agent can retrieve on
demand.

## The pillar we pick: agent-facing retrieval

There are three plausible identities for this tool — a task tracker, an agent
orchestrator, or a retrieval layer. We pick the third, and everything else is a
consequence.

**Why retrieval wins:**

- **Tracking is already solved.** Linear, Jira, Notion, and GitHub Issues all
  track tasks better than we will. Competing there is a losing battle, and
  users who need tracking already have tracking.
- **Orchestration is the noisy layer.** Every week brings a new agent framework
  — LangChain, LangGraph, CrewAI, Smol, Claude Code itself. Whatever we build
  here gets obsoleted on a six-month cadence, and we'll never be the biggest
  player.
- **Retrieval is the unsolved layer and the part agents actually need.** Every
  coding agent is bottlenecked on "what's the relevant context for this
  change?" Today that's answered by stuffing files into the context window and
  hoping. Sidecar answers it with a structured, queryable record of decisions,
  worklog entries, prior runs, and compiled prompts — all local, all
  inspectable, all built up incrementally from actual work.

**What this means in practice:**

- The retrieval-shaped surfaces are the ones we invest in: `sidecar context`,
  compiled-prompt section trimming, linked-context between runs, previous-run
  summaries in dual-runner pipelines.
- Tracking features exist, but they're a byproduct of recording work, not the
  reason to use the tool. We will not compete with Linear on Gantt charts.
- Orchestration features exist, but they stay thin. `sidecar run` spawns a
  runner and records the result — it does not try to be a workflow engine. The
  pipeline in #7 is the ceiling of our orchestration ambition, not the floor.

**The shape of the hero demo:**

> "I'm an agent working on this codebase. Before I start, I run
> `sidecar context` and get back the five decisions, three open tasks, and two
> previous runs that touched the files I'm about to edit. I didn't have to ask
> the user 'what's the history here?' — the history was already structured and
> retrievable."

That's the pitch. Everything else is a feature that serves that pitch, or it's
scope we should cut.

## What we explicitly do NOT want to be

- A project management tool. No burndowns, no sprints, no team dashboards.
- An agent framework. No tool-use loops, no function-calling primitives.
- A vector DB / RAG service. Retrieval is over structured records, not
  embeddings over arbitrary text. (Someone else can build embeddings on top of
  our records later.)
- A team collaboration tool. Sidecar is single-project, local-first, and
  optimized for the one developer + one agent loop.

## Taglines we've considered

- ✅ **"Local memory for coding agents."** — Picks retrieval, picks local,
  picks the user. Winner.
- "The sidecar your agent is missing." — Cute but doesn't say what it does.
- "Your project's decision log, for agents." — Too narrow; worklog + runs
  matter just as much as decisions.
- "Structured context for AI-assisted development." — Accurate but flat.

## How this changes what we ship

Concrete implications for the near-term roadmap:

1. **Keep investing in `sidecar context` as the marquee command.** It should
   be the first thing in the README, the first thing in `sidecar demo`, and
   the first thing an agent runs when it starts work. Every other command
   feeds it.
2. **Every new feature passes the retrieval test.** Ask: does this make
   `sidecar context` more useful, or the compiled prompt more targeted? If
   no, it's probably not this tool's job.
3. **De-emphasize the CLI's tracking surfaces in docs.** `sidecar task list`
   and `sidecar worklog list` stay useful as debugging aids, but the README
   should frame them as "the records that retrieval reads from," not "your
   task tracker."
4. **The UI is a triage + inspection surface, not a PM surface.** The Triage
   tab is exactly right. The Mission tab is a debugging view over the
   underlying records. We do not need a Kanban board.
5. **Document the data model.** If retrieval is the product, the shape of the
   records is the API. A docs page that describes task packets, run records,
   and event types should land before we add more features.
