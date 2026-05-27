# MCP Server Best Practices

> Research reference for the JT Power Tools MCP server. Distilled from Anthropic's
> guidance, the June 2025 MCP specification, and published patterns from
> production MCP server teams.

## Scope & tool budget

- **One server, one domain.** Model your MCP server around a single
  microservice domain and expose only the capabilities that belong to that
  domain. Mixing domains forces the agent to scan irrelevant tools on every
  turn.
- **Don't 1:1 the API.** Design your toolset around clear use cases and avoid
  mapping every API endpoint to a separate tool. Endpoint-per-tool servers
  (the classic SDK auto-gen trap) bloat context and confuse selection.
- **Aim for a small toolset.** In MCP-heavy setups you can easily end up
  spending 20–40+% of your context window on tool names, descriptions, and
  schemas alone. Anthropic estimates that in some environments roughly 40% of
  overall token usage is consumed by MCP metadata. The 32-tool collapse from
  81 in JT Power Tools was the right move; the ceiling for most clients
  (including ChatGPT's ~60) is real and observed in the wild.
- **Build for workflows, not operations.** Each tool should map directly to
  what users actually want to do. Instead of exposing individual API
  operations, you're creating tools that handle entire workflows. A "context"
  tool that returns job + budget + schedule in one call beats three
  round-trips every time.

## Naming

- **Use `{service}_{action}_{resource}`.** Service-prefixed, action-oriented
  names. Your MCP server runs alongside others. If GitHub and Jira both have
  `create_issue`, the agent guesses. Examples: `slack_send_message`,
  `linear_list_issues`, `sentry_get_error_details`.
- **Naming constraints worth respecting:**
  - Must start with a letter
  - Letters, numbers, and underscores only
  - Avoid hyphens (AWS Nova does not support them)
  - Use either camelCase or snake_case consistently across all tools
- **Each name must be unique and self-explanatory.** The agent picks tools on
  semantic match alone — ambiguity costs a wrong call.

## Tool descriptions (where most servers fail)

- **Write descriptions as prompts, not docstrings.** Tool descriptions are
  instructions that guide LLM decision-making. Include:
  - What the tool does (purpose)
  - When to use it (user-intent patterns or scenarios)
  - Context of the output (what it's used for downstream)
  - Parameters and their semantics
  - Error conditions
- **Required fields per tool:** `name`, `description`, `inputSchema`,
  `outputSchema`.
- **Include trigger phrasing.** Describe the user-intent patterns that should
  fire the tool. Same principle the Titus skills already use, applied to MCP
  tool descriptions.
- **Note operational limits inline.** If a tool can only fetch 10 items per
  call, say so in the description. The agent will then include
  `max_results: 10` in its first call rather than discovering the limit by
  trial and error.

## Input & output schemas

- **Strict, typed, enum'd.** MCP's tools design expects clearly typed,
  discoverable operations with accurate write schemas that include enums
  when possible, plus thoroughly documented failure modes. Enums prevent the
  agent from inventing values.
- **Use Pydantic (or equivalent) for self-documenting schemas.** Inline field
  descriptions, automatic type validation, constrained values via enums.
  Makes schemas self-documenting and improves LLM understanding of valid
  parameter options.
- **Use structured outputs.** The June 2025 MCP specification introduced the
  `outputSchema` and `structuredContent` fields, which enable precise, typed
  outputs. Keep error messages actionable with machine-readable guidance.
- **Provide canonical examples in the schema** — inputs, outputs, AND error
  cases. The agent learns from examples faster than from prose.

## Response shape — the token-efficiency battleground

- **Don't dump rows.** Traditional code reads lists; agents pay tokens per
  row. If a tool returns ALL contacts and the agent has to scan through each
  one token-by-token, it's wasting limited context on irrelevant data. The
  better approach: skip to the relevant page first.
- **Paginate everything that lists.** Use pagination tokens and cursors for
  list operations to keep responses small and predictable.
- **Filter server-side.** Push filtering/searching into tool parameters so
  the agent never sees rows it doesn't need. (`jt_budget_find` with
  flat-narrow output is exactly this pattern.)
- **Preprocess & summarize.** Build preprocessing steps to summarize large
  datasets rather than returning raw payloads.
- **Be both LLM-parsable and human-readable.** Use structured content with
  JSON schemas for the model alongside traditional content blocks for users.

## Idempotency, safety, errors

- **Idempotent writes with client-generated IDs.** Make tool calls
  idempotent, accept client-generated request IDs, return deterministic
  results for the same inputs. Agents retry and parallelize — non-idempotent
  writes cause duplicates.
- **Be careful exposing destructive endpoints.** Do not expose PUT or DELETE
  endpoints unless absolutely necessary. LLMs are non-deterministic and could
  unintentionally alter or damage systems or data. When you must, make the
  destructive scope explicit in both name and description.
- **Errors should teach.** Causes + examples + remediation payloads
  (ready-to-call next tools). An error that says "missing field X — call
  `tool_y` first to get it" is worth 10× a generic 400.
- **Offer dry-run/simulate.** `dry_run: true` returns a diff without side
  effects. Lets the agent self-correct before committing.
- **Timeouts.** Prevent hanging tools. Protects infra, prevents stuck agents,
  required in enterprise systems.

## Token efficiency at the architecture level

- **Recognize the upfront-load cost.** The LLM client loads all tool metadata
  into context up-front so the model knows which tools exist and how to use
  them. If your agent uses many tools or complex schemas, the prompt can
  grow significantly. Every tool you expose permanently eats a slice of the
  available context.
- **Consider on-demand discovery for large servers.** Agents should discover
  and load tools on-demand, keeping only what's relevant for the current
  task. Anthropic's `tool_search` pattern (which Claude Code uses in this
  very session) is the reference implementation.
- **Code execution > chained tool calls for orchestration.** When using
  natural-language tool calling, each invocation requires a full inference
  pass and intermediate results pile up in context whether they're useful or
  not. Code is a natural fit for orchestration logic — loops, conditionals,
  data transformations. Anthropic reported a 98.7% reduction (150,000 →
  2,000 tokens) on real workflows by moving from tool-call loops to code
  execution against MCP.

## Versioning & evolution

- **Capability negotiation on connect.** Advertise supported protocol,
  schema, features; negotiate on connect.
- **Deprecation warnings in responses.** Mark and warn in responses; document
  timelines and fallbacks. Don't break clients silently.
- **Add tools incrementally.** Monitor which tools are used most frequently.
  Refine descriptions based on usage patterns.

## Testing — non-negotiable

- **Iterate with real agent workflows.** Anthropic's official guidance is a
  three-step iterative process: **Prototype → Evaluate → Collaborate**.
  Ship → measure tool-call accuracy → rewrite descriptions → re-test.
- **Test multi-turn conversations.** Single-shot accuracy lies; the real test
  is whether the agent picks the right tool after 3 turns of accumulated
  context.
- **Monitor tool-hit-rate per description.** If a tool is rarely called when
  it should be, the description is wrong, not the tool.

## Sources

- Anthropic — Writing effective tools for AI agents
  (`https://www.anthropic.com/engineering/writing-tools-for-agents`)
- Anthropic — Advanced tool use & code execution with MCP
  (`https://www.anthropic.com/engineering/advanced-tool-use`)
- MCP Specification (June 2025) — `outputSchema`, `structuredContent`
- The New Stack — 15 Best Practices for Building MCP Servers in Production
- Docker — MCP Server Best Practices
- MCPcat — MCP Server Best Practices
- Phil Schmid — MCP Best Practices
- Workato — MCP Tool Design
- AWS Prescriptive Guidance — MCP Tool Strategy & Definitions
- Modelcontextprotocol — Writing Effective Tools
- Merge.dev — MCP Tool Descriptions
- Substack (Code Agents Alpha) — Token-Efficient Agents: Building MCP-Heavy
