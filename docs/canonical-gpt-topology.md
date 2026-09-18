# Canonical GPT Command Center Topology

## Purpose

This document is the canonical product-definition record for the GPT Command
Center specialist ecosystem. It preserves the established GPT identities,
roles, ownership boundaries, and intended workflow relationships without
activating additional specialists in production.

The product definition is broader than the currently active production
registry. Production routing and execution must continue to use only
explicitly approved and implemented registry/runtime state.

## Canonical Inventory

| ID | Display name | Product role | Primary responsibility |
|---|---|---|---|
| `gpt-command-center` | GPT Command Center | ORCHESTRATOR | Orchestration, request intake, routing/workflow coordination, GPT ecosystem audit |
| `node-link-graph-architect` | Node-Link Graph Architect | ROUTABLE_SPECIALIST | Node-link and graph-system design |
| `resume-gatekeeper` | Resume Gatekeeper | ROUTABLE_SPECIALIST | Resume and job-application materials |
| `tuner-pro-oracle` | Tuner Pro Oracle | ROUTABLE_SPECIALIST | TunerPro-related work |
| `business-idea-validator` | Business Idea Validator | ROUTABLE_SPECIALIST | Business idea validation |
| `logic-machine` | Logic Machine | ROUTABLE_SPECIALIST | Formal reasoning and logical consistency analysis |
| `architecture-security-advisor` | Architecture & Security Advisor | ROUTABLE_SPECIALIST | Architecture review, security review, and technical architecture/security design |
| `project-folder-forge` | Project Folder Forge | BUILDER_OR_WORKFLOW_UTILITY | ChatGPT Project setup and project/folder structure |
| `github-oracle` | GitHub Oracle | ROUTABLE_SPECIALIST | GitHub repositories, pull requests, CI, and GitHub workflow concerns |
| `python-oracle` | Python Oracle | ROUTABLE_SPECIALIST | Python engineering |
| `military-job-school-finder` | Military Job & School Finder | ROUTABLE_SPECIALIST | Military jobs and schools lookup |
| `windows-senior-support-engineer` | Windows Senior Support Engineer | ROUTABLE_SPECIALIST | Windows troubleshooting and support |
| `senior-software-project-manager` | Senior Software Project Manager | ROUTABLE_SPECIALIST | Software delivery planning and project-management coordination |
| `everyday-nutritionist` | Everyday Nutritionist | ROUTABLE_SPECIALIST | Nutrition planning |
| `csharp-quant-engine` | C# Quant Engine | ROUTABLE_SPECIALIST | Quantitative analysis and implementation in C#/.NET |
| `local-ai-qa-repair-lab` | Local AI QA & Repair Lab | ROUTABLE_SPECIALIST | Local AI evaluation, QA, and repair |
| `product-definition-forge` | Product Definition Forge | ROUTABLE_SPECIALIST | Product definition, requirements, and product scope |
| `mvp-forge` | MVP Forge | ROUTABLE_SPECIALIST | MVP definition, specification, and build planning |
| `travel-agent` | Travel Agent | ROUTABLE_SPECIALIST | Travel and lodging |
| `vehicle-repair-assistant` | Vehicle Repair Assistant | ROUTABLE_SPECIALIST | Vehicle-specific repair |
| `gpt-builder` | GPT Builder | BUILDER_OR_WORKFLOW_UTILITY | GPT construction, configuration, and GPT/prompt construction |
| `codex-prompt-builder` | Codex Prompt Builder | BUILDER_OR_WORKFLOW_UTILITY | Codex prompt preparation and implementation handoff preparation |
| `treasure-hunter` | Treasure Hunter | UNKNOWN_PENDING_REVIEW | Pending review; no approved routing ownership yet |
| `policy-document-reviewer` | Policy Document Reviewer | ROUTABLE_SPECIALIST | Auto-insurance policy document review |
| `equipment-repair-assistant` | Equipment & Repair Assistant | ROUTABLE_SPECIALIST | Broad equipment and appliance repair |

Canonical counts:

- ORCHESTRATOR: 1
- ROUTABLE_SPECIALIST: 20
- BUILDER_OR_WORKFLOW_UTILITY: 3
- UNKNOWN_PENDING_REVIEW: 1
- Total: 25

## Product Role Classification

`gpt-command-center` is the orchestration layer. It receives requests,
coordinates routing and workflows, and audits the GPT ecosystem; it does not
become a substantive fallback owner merely because no specialist matches.

The 20 `ROUTABLE_SPECIALIST` entries are user-facing intent owners for their
approved task categories. The three
`BUILDER_OR_WORKFLOW_UTILITY` entries remain valid explicit destinations for
the narrow categories they own. Their utility classification does not mean
they are omitted from routing, and it does not make them generic fallback
specialists.

`treasure-hunter` remains registered as pending review. It has no approved
ownership and must not become an authoritative automatic routing target until
reviewed and approved.

## Ownership Snapshot

The intended ownership boundaries are:

- `gpt-command-center`: orchestration, request intake, routing coordination,
  workflow coordination, and GPT ecosystem audit.
- `node-link-graph-architect`: node-link and graph-system design.
- `resume-gatekeeper`: resumes and job-application materials.
- `tuner-pro-oracle`: TunerPro work.
- `business-idea-validator`: business idea validation.
- `logic-machine`: formal reasoning and consistency checks.
- `architecture-security-advisor`: architecture and security review/design.
- `project-folder-forge`: ChatGPT Project setup and project/folder structure.
- `github-oracle`: GitHub repositories, pull requests, and CI workflows.
- `python-oracle`: Python engineering.
- `military-job-school-finder`: military jobs and schools lookup.
- `windows-senior-support-engineer`: Windows troubleshooting and support.
- `senior-software-project-manager`: software delivery planning and project
  management.
- `everyday-nutritionist`: nutrition planning.
- `csharp-quant-engine`: quantitative C#/.NET analysis and implementation.
- `local-ai-qa-repair-lab`: local AI evaluation, QA, and repair.
- `product-definition-forge`: product definition, requirements, and scope.
- `mvp-forge`: MVP specification and build planning.
- `travel-agent`: travel and lodging.
- `vehicle-repair-assistant`: vehicle-specific repair.
- `gpt-builder`: GPT construction and configuration.
- `codex-prompt-builder`: Codex prompt and implementation handoff
  preparation.
- `treasure-hunter`: ownership pending review.
- `policy-document-reviewer`: auto-insurance policy review.
- `equipment-repair-assistant`: equipment and appliance repair.

## Structural Principles

1. GPT Command Center is the orchestration layer.
2. Logical Specialist != Runtime.
3. Routing != execution authority.
4. A GPT may be a logical intent owner, direct narrow destination, workflow
   destination, builder/utility, or an explicitly defined combination.
5. Builder/workflow GPTs are not omitted solely because they are not generic
   logical-routing peers.
6. Codex is execution machinery, not a logical routing specialist.
7. Runtime availability is independent from logical ownership.
8. Navigation/share URLs do not establish executable runtime capability.
9. Discovery does not grant routing approval.
10. `treasure-hunter` remains pending until explicitly reviewed and approved.

## Product Groups

### Orchestration

- `gpt-command-center`

### Product / Planning

- `business-idea-validator`
- `product-definition-forge`
- `mvp-forge`
- `senior-software-project-manager`

### Builder / Structure Utilities

- `project-folder-forge`
- `gpt-builder`
- `codex-prompt-builder`

### Technical / Implementation Specialists

- `architecture-security-advisor`
- `node-link-graph-architect`
- `github-oracle`
- `python-oracle`
- `csharp-quant-engine`
- `local-ai-qa-repair-lab`
- `windows-senior-support-engineer`

### Domain Specialists

- `resume-gatekeeper`
- `tuner-pro-oracle`
- `logic-machine`
- `military-job-school-finder`
- `everyday-nutritionist`
- `travel-agent`
- `vehicle-repair-assistant`
- `policy-document-reviewer`
- `equipment-repair-assistant`

### Pending Review

- `treasure-hunter`

These groups describe product ownership. They are not, by themselves, an
executable precedence algorithm or a promise that every transition has been
implemented.

## Builder and Workflow Utilities

### Project Folder Forge

`project-folder-forge` is the explicit owner/destination for project and
folder-structure requests. It may be selected directly for those requests and
may participate in broader workflows once such transitions are implemented.

### GPT Builder

`gpt-builder` is the explicit owner/destination for GPT construction and
configuration requests. It may be selected directly for those requests and
may participate in broader workflows once such transitions are implemented.

### Codex Prompt Builder

`codex-prompt-builder` owns Codex prompt preparation and implementation
handoff preparation. It is already implemented as the `PROMPT_BUILD` stage in
`SOFTWARE_DELIVERY`. Standalone direct routing for explicit Codex-prompt work
is part of the product definition, but production support for that separate
entry path may require future implementation.

## Implemented Software Delivery Workflow

The implemented predefined workflow is:

```text
SPECIALIST_ANALYSIS
        -> PROMPT_BUILD
        -> CODEX_EXECUTION
        -> VALIDATION
        -> COMPLETE
```

The originating logical specialist owns the user task. The
`codex-prompt-builder` owns `PROMPT_BUILD` as a workflow utility. Codex owns
`CODEX_EXECUTION` as the runtime/executor, and validation is a workflow
validation stage.

These internal handoffs do not automatically create new logical routing
decisions. The current `SOFTWARE_DELIVERY` definition and evidence-gated
behavior in `src/predefined-workflow.ts` and `src/orchestrator.ts` remain
authoritative for implemented workflow behavior.

## Current Implementation vs Canonical Product Definition

### Currently implemented

- `architecture-security-advisor` is the canonical logical specialist in the
  active production registry.
- GPT Command Center provides orchestration and routing coordination.
- `codex-prompt-builder` is implemented as the prompt-build workflow stage.
- Codex execution and validation runtime stages exist.
- PostgreSQL persists workflow, routing, attempt, artifact, and evidence state.
- `SOFTWARE_DELIVERY` is implemented and restart-tested.

### Canonical product definition

The broader 25-GPT ecosystem in this document is the intended product
structure. Documenting it does not activate those specialists, grant routing
approval, create runtimes, or change execution authority. Future work must
intentionally synchronize production registry and routing behavior with this
contract.

## Known Routing Boundaries

- `product-definition-forge` defines what the product is; `mvp-forge` defines
  the smallest practical build or release.
- `gpt-builder` owns GPT construction/configuration; `project-folder-forge`
  owns project and folder structure.
- `gpt-builder` creates/configures GPTs; `codex-prompt-builder` prepares
  implementation instructions intended for Codex.
- `github-oracle` owns GitHub, repository, pull-request, and CI concerns;
  `python-oracle` owns Python engineering concerns.
- `vehicle-repair-assistant` owns vehicle-specific repair;
  `equipment-repair-assistant` owns broader equipment/appliance repair.
- GPT Command Center orchestrates and does not become the substantive
  fallback owner simply because no specialist matches.

These are ownership boundaries, not a complete precedence algorithm.

## Runtime and Execution Separation

Logical registration does not imply executable runtime availability. A
specialist may be routable as a logical owner while its runtime is
`UNVERIFIED`, `MANUAL_ONLY`, `DISABLED`, or otherwise unavailable. Runtime
availability must be established separately through approved runtime/provider
evidence.

Routing does not grant execution authority. Execution still requires the
current authorization policy, server-derived Principal, trusted
`ExecutionContext`, repository/ref validation, runtime validation, and
evidence-gated lifecycle controls.

Navigation or share URLs are manual destinations only; they are not executable
API endpoints.

## Pending Review

`treasure-hunter` has no approved routing ownership in the current product
contract. It must remain non-authoritative for automatic routing until an
explicit review and approval establishes its ownership, capabilities,
exclusions, and runtime relationship.

No generic fallback specialist is currently approved. `NO_MATCH` remains a
valid result when no approved owner exists. No approved equivalent-specialist
set is currently established; similarity does not imply equivalence.

## Future Synchronization Rule

This document defines product intent; it does not mutate production state.
Future implementation tasks must separately and deliberately synchronize the
canonical registry, routing policy, runtime metadata, corpus coverage, and
workflow integrations with this product definition. Until then, current
production behavior remains limited to the implemented registry and workflow
contracts described above.

## Canonical Product and MVP Interpretation

This section records the product interpretation supported by this document and
the current README. It distinguishes the intended open specialist ecosystem
from the smaller workflow that is currently executable. The original 25
entries are protected built-in seeds, not a product-level maximum.

### Product definition

- **Product:** GPT Command Center, an extensible orchestration and
  evidence-gated workflow system for routing a user's request to an existing
  specialist, coordinating several specialists where appropriate, or creating
  a validated specialist when the catalog lacks sufficient capability
  coverage. When authorized and applicable, work proceeds through Codex and
  validation.
- **Primary user:** A person submitting a task that may require a domain
  specialist, repository work, planning, or a builder utility. The source
  materials do not define a narrower persona or a separate multi-user product
  segment.
- **Core problem:** A request should reach the right GPT-owned intent area,
  remain within approved authority, and produce a reviewable outcome instead
  of an unbounded or opaque handoff. The user should not need to know whether
  the needed specialist already exists.
- **Core workflow:** request intake → canonical routing → focused
  clarification or approval when required → specialist analysis → optional
  Codex prompt/build execution → validation → result, evidence, or explicit
  manual handoff.
- **User-visible output:** A routed workflow with its current status,
  specialist decision/history, clarification or approval state, events, and
  final artifacts/results or a deterministic failure/manual-handoff outcome.
- **Human-in-the-loop:** Humans may clarify routing, override the selected
  specialist, approve materially changed protected actions, inspect results,
  and recover uncertain work. An override changes routing policy state; it does
  not itself execute a specialist.
- **Codex role:** Codex is execution machinery for implementation handoff and
  repository work, not a logical routing specialist.
- **Deployment boundary:** Local mode may use the non-durable MemoryStore for
  development/test use. Deployed operation requires PostgreSQL, token
  authentication, approved repository policy, and the configured runtime
  prerequisites.

### MVP definition

The source-supported MVP is the smallest safe version of the Command Center
that accepts a task, routes it through an approved specialist contract, and
returns durable evidence about the outcome.

**Must have**

- authenticated request intake and authorized repository/resource context;
- canonical specialist selection with explicit no-match and clarification
  outcomes;
- durable workflow state, routing history, clarification, approval, attempt,
  event, and artifact/result records in deployed mode;
- state-valid specialist execution and, for software delivery, the
  specialist → prompt-builder → Codex → validation path;
- user-visible workflow status, results, evidence, and manual-handoff/failure
  outcomes;
- canonical runtime/capability binding, bounded repository execution, and
  recovery-safe authorization.

**Should have**

- explicit user override with stale-decision protection;
- approval gates for materially changed protected actions;
- specialist inventory/readiness reporting;
- routing evaluation and release-quality reporting.

**Later / post-MVP**

- activating additional specialist runtimes beyond the currently configured
  runtime evidence;
- standalone direct production support for every builder/workflow utility;
- broader multi-stage workflows beyond the implemented `SOFTWARE_DELIVERY`
  contract;
- unrestricted anonymous specialist mutation, arbitrary runtime/tool grants,
  equivalent-specialist sets without review, and automatic generic fallback
  ownership.

**Non-goals**

- treating navigation/share URLs as executable runtimes;
- making Codex a routing specialist;
- auto-approving discovered specialists;
- silently routing `NO_MATCH` requests to an unrelated specialist;
- presenting the orchestration service as a general-purpose unrestricted
  agent or as a replacement for human approval of consequential actions.

### Current implementation status

- **Implemented:** canonical registry and routing, clarification and approval
  gates, authorization, durable PostgreSQL workflow/evidence persistence,
  bounded software-delivery orchestration, Codex handoff/execution stages,
  validation, recovery/manual handoff, and operational readiness controls.
- **Partially implemented:** the broader 25-entry ecosystem is represented
  canonically and logically routable where approved, and validated dynamic
  specialists can now be added to the effective catalog. Most entries and
  newly created specialists still have no configured executable runtime;
  direct standalone paths for some utilities remain future work.
- **Product-critical gap:** none for the documented software-delivery MVP;
  deployment credentials/provider connectivity and production backup/restore
  remain operational validation conditions rather than product-definition
  gaps.

Collective specialist coverage is executable through a durable ordered
orchestration plan. Plans reuse the existing workflow stage, attempt, artifact,
authorization, and recovery boundaries; they are not caller-authored DAGs.
The software-delivery workflow remains the supported Codex vertical slice, and
specialists without an approved active runtime produce truthful manual handoff
rather than fabricated execution.
- **Scope caution:** security, persistence, and recovery controls are enabling
  infrastructure. They should remain invisible to the normal MVP user
  experience and should not displace implementation of missing user-facing
  product surfaces in future planning.
