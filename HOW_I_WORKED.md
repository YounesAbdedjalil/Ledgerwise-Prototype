## 1. Introduction

This document describes how I worked while building the Ledgerwise
platform for the UNSCALE AI Engineer case study.

The objective: build and deploy an AI SDR platform for Ledgerwise, a
fictional but typical US bookkeeping firm serving e-commerce brands. The
platform's AI agent performs five core jobs:

1.  Research --- find companies matching Ledgerwise's ICP
2.  Qualify --- score them and justify each score with a source
3.  Write --- draft a personalized first email per qualified company,
    with every fact sourced
4.  Reply --- answer prospect replies, follow the client's hard rules,
    and hand off to a human when unsure
5.  Book calls --- offer real free slots and book the call

The ICP I researched against: US e-commerce brands (Shopify, Amazon, or
their own store), roughly \$1M--\$10M annual revenue, 5--50 employees,
with a growth or pain signal (finance/ops hiring, recent funding, a new
sales channel), and a reachable founder, COO, or finance lead.

How I worked: I planned my tool usage before writing code, splitting
work across AI agents with distinct roles rather than using one for
everything.

  -----------------------------------------------------------------------
  Tool                                Role
  ----------------------------------- -----------------------------------
  ChatGPT                             Main coding agent --- where most of
                                      the build happened

  DeepSeek                            Conception, planning, and writing

  Claude                              Escalation --- problems the other
                                      tools could not solve

  OpenCode                            Routine coding --- UI/UX and bug
                                      fixes (limited: consumed tokens too
                                      quickly)

  Tavily                              Research --- company discovery

  Jina.ai                             Research --- page extraction into
                                      citable text

  Gemini + Groq                       Email drafting and reply generation
  -----------------------------------------------------------------------

Cost: every tool was free or freemium. I spent nothing.

Two planning mistakes up front. First, I did not include Codex in the
team, which cost me context continuity --- I re-explained the codebase
between ChatGPT and Claude sessions far more often than if a
long-context agent had been in the loop, and that cost time I later
needed for booking. Second, I let DeepSeek select the entire tool stack
from a freemium shortlist without evaluating alternatives myself. It
worked, but it meant I had to reverse-engineer my own tooling decisions
when writing this document. Both are covered in Section 6.

------------------------------------------------------------------------

## 2. What I built --- scope and stack

Stack: React (frontend) Â· Node.js (backend) Â· Supabase (database) Â·
Vercel (hosting).

  -----------------------------------------------------------------------
  Area                    Status                  Detail
  ----------------------- ----------------------- -----------------------
  Research                Working                 âŸ¨FILLâŸ© real companies
                                                  collected, with sourced
                                                  facts and contacts

  Qualification           Working                 Score with per-reason
                                                  source links

  Company screens         Working                 List with scores;
                                                  detail view with
                                                  reasons and clickable
                                                  sources

  Email drafting          Working                 Fact-locked drafts
                                                  generated from stored
                                                  source rows

  Email review queue      Working                 Approve / edit / reject
                                                  before send

  Email sending           Simulated               Resend wired; no
                                                  verified domain

  Reply agent             Working                 Answers replies,
                                                  applies rule guards,
                                                  escalates to human

  Conversation UI +       Working                 Full thread view; human
  takeover                                        can take over any
                                                  thread

  Booking                 Partial                 Cal.com slot display
                                                  only; no write action

  Auth + deployment       Working                 âŸ¨FILL: auth methodâŸ© Â·
                                                  live at âŸ¨FILL: URLâŸ©
  -----------------------------------------------------------------------

Why email sending is simulated. I wired a Resend integration, but Resend
only permits sending to your own verified address until you verify a
domain you own. Without a domain, real outbound to 30 prospects is
impossible. So I built the full approve â†’ send pipeline and simulated
the send step. The integration point is real and swappable --- adding a
verified domain makes it live without redesign.

Because sending is simulated, inbound replies are injected rather than
received by webhook. This keeps the demo path honest: the reply agent,
rule guards, and handoff logic are real and testable; the transport
layer is the only simulated piece.

What is not finished: booking. Cal.com is integrated for slot display
--- the platform fetches and shows real available availability. The
book-a-call action is not implemented end to end, so a booking made in
the UI does not write to the calendar or to the "Booked calls" screen.
This is the largest functional gap against the brief, and it is a
scoping failure on my side, not a technical blocker: Cal.com's free API
supports creating a booking directly, and the booked-calls screen is a
simple table read from Supabase. I ran out of time on it.

------------------------------------------------------------------------

## 3. Tools I used, step by step, and why

Research: Tavily + Jina.ai. Both were recommended by DeepSeek when I
asked it to shortlist freemium research tools, and both held up in
practice. Tavily handled discovery --- finding candidate companies
against the ICP --- while Jina.ai handled page extraction, turning
company sites into clean, readable text I could cite. I used both
because discovery and extraction are different jobs: Tavily finds the
right pages, Jina returns text I can attribute a fact to. Every stored
fact carries its source URL, which is what the client's sourcing rule
requires.

Qualification: LLM scoring against an explicit ICP rubric, with each
reason written back against a stored source row rather than generated
freehand. I chose this because it makes fabrication structurally harder
--- the model selects from evidence instead of recalling facts.

Email writing: Gemini + Groq. Both came from the same freemium
shortlist. I prioritized getting a working pipeline over benchmarking
alternatives, given the time box. Both generate only from the company's
stored source rows, never freehand, because the sourcing rule is a hard
constraint rather than a style preference.

Replies: LLM generation with code-level rule guards in front of it (see
Section 5). I did not rely on prompt instructions alone, because
prompt-only rules degrade across conversation turns.

Booking: Cal.com API, with Google Calendar as the intended downstream
calendar. Chosen for a genuinely free API tier and because it returns
real availability, which the brief explicitly requires. Slot display
works; booking creation does not.

The platform: React + Node.js + Supabase, because Supabase provides
Postgres, auth, and a REST layer on a free tier, and Vercel deploys a
Node backend with near-zero configuration. Both keep the platform online
at no cost for the required two weeks.

Hosting: Vercel, chosen over a tunnel or local server because the brief
requires a stable public URL for two weeks.

AI coding tools: ChatGPT as primary, Claude for escalation, OpenCode for
small isolated fixes, DeepSeek for planning --- chosen for cost, and
because splitting roles kept each session's context focused. Tried and
dropped: OpenCode was intended for routine coding but consumed tokens
too quickly to be practical, so I restricted it to small, isolated fixes
and moved routine work back to ChatGPT.

------------------------------------------------------------------------

## 4. My plan, and how it changed

Original plan:

1.  Deploy a skeleton with auth early.
2.  Run research to 30+ sourced companies.
3.  Build qualification, email drafting, and the review queue.
4.  Build reply handling with rule guards.
5.  Integrate real booking.
6.  Test, then package.

What actually changed:

-   Research consumed far more time than planned. Sourcing real
    companies with citable evidence --- revenue band, headcount, a
    genuine trigger, and a reachable contact --- is slow, and I let it
    run long. That single decision is what cost me booking.
-   Email sending moved from real to simulated mid-build, when I hit the
    Resend domain requirement. I chose to keep the pipeline and simulate
    transport rather than spend hours on a domain I did not own.
-   Booking slipped from "integrate and test" to "display slots only."
    The UI shows real availability; the write action never landed.
-   OpenCode was effectively dropped from the coding workflow due to
    token consumption.
-   Codex was never added --- a planning omission I would correct first
    next time.

The honest summary: I over-invested at the front of the funnel
(research, drafting) and under-invested at the back (replying well,
booking) --- the opposite of the correct priority order for this brief.

------------------------------------------------------------------------

## 5. Rules and context I gave my AI coding tools

Product rules given to every session (mirroring the client's
constraints):

-   Never quote a price. Pricing is discussed on a call only.
-   Never state a fact about a company that is not in the stored source
    rows. No source, no claim.
-   Opt-out language ("stop", "unsubscribe", "not interested", and
    equivalents) triggers permanent suppression --- no exceptions, no
    re-contact.
-   If asked whether the user is talking to a bot, answer honestly.
-   Low-confidence or out-of-scope requests (pricing, legal, custom
    scope, complaints) go to a human.

Engineering rules given to the coding agent:

-   Stay on the fixed stack: React, Node.js, Supabase, Vercel. No new
    dependencies without asking.
-   Rule enforcement lives in code guards, not only in prompts.
-   Every generated fact must carry its source reference through to the
    UI.
-   Do not fabricate seed data --- if a company or contact cannot be
    sourced, drop it.
-   Keep the sales-team UI non-technical: no raw JSON, no internal IDs
    in the interface.

### 5.1 Handoff protocol when an agent runs out of context

Running several agents on free tiers meant sessions regularly hit token
limits mid-task. Losing context mid-build is expensive: the next agent
re-learns the codebase, repeats solved mistakes, and contradicts earlier
decisions. I developed a three-step protocol to make handoffs cheap.

**Step 1 --- Structured baton pass.** Before a session died, I
instructed the agent to write its own handoff prompt: what it was
building, what was finished, what was half-finished, which files it
touched, what it had tried and abandoned, and what the next agent should
do first. That prompt became the opening context for the next session.
The dying agent wrote its own replacement's briefing --- it already held
the context, so it was the cheapest source of it.

**Step 2 --- Zipped codebase upload.** I packaged the current platform
as a zip and uploaded it to the incoming agent, so it worked from the
real code rather than a description of the code. This mattered most on
structural changes: a summary tells the next agent what the code is
supposed to do; the zip tells it what the code actually does --- and
those had already diverged more than once.

**Step 3 --- Co-coding between ChatGPT and Claude.** For hard problems I
ran both agents on the same task rather than switching between them: one
produced a solution, I passed it to the other for review and correction,
and I arbitrated where they disagreed. I did this only for problems that
had already defeated a single agent, because it is slower and more
expensive than one agent working alone.

Why this mattered: without it, every token exhaustion reset me to zero
and I re-explained the same context repeatedly. With it, a handoff cost
minutes instead of hours. It is also why my session exports are complete
and readable rather than a pile of abandoned fragments.

------------------------------------------------------------------------

## 6. Where the AI got it wrong, and how I noticed

  -----------------------------------------------------------------------
  What the AI did wrong   How I noticed           What I changed
  ----------------------- ----------------------- -----------------------
  I omitted Codex during  Re-explained the        Would include a
  tool planning           codebase repeatedly     long-context agent in
                          between ChatGPT and     the core team next time
                          Claude sessions;
                          repeated context, lost
                          time

  OpenCode burned tokens  Watched consumption     Restricted it to small
  on routine fixes        after a few UI tasks    isolated fixes; moved
                                                  routine work to ChatGPT

  I let DeepSeek choose   When writing this       Traced each tool's
  the whole tool stack    document I could not    actual role in the code
  without evaluating      immediately justify     before writing it up.
  alternatives myself     each tool               Lesson: delegating
                                                  selection is fine, but
                                                  verify the reasoning,
                                                  not just the output

  Handoff prompts         A later agent           Moved the standing
  sometimes dropped       re-introduced behaviour rules into a fixed
  constraints given       I had already corrected block pasted at the
  earlier in a session                            start of every session,
  --- a rule set in hour                          instead of trusting
  2 was missing from the                          each agent to carry
  baton written in hour 6                         them forward

  âŸ¨FILL: one more         âŸ¨FILL: how you caught   âŸ¨FILL: what you
  concrete example ---    itâŸ©                     changedâŸ©
  e.g.Â an invented
  company fact, a price
  in a draft, a misjudged
  company size, a broken
  UI elementâŸ©
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 7. How I checked that the agent's answers are right

I did not run a formal, numbered test suite before submission. That is a
real weakness here, and it is the first thing I would fix with more
time. What I did instead:

**Build and static checks.** I ran the project's npm scripts --- âŸ¨FILL:
the ones you actually ran, e.g.Â build, lintâŸ© --- after changes, to catch
broken builds, type errors, and lint failures before deploying. There is
no unit test suite; npm was used for build and static checks only.

**Live end-to-end walkthroughs.** I exercised the platform as the
Ledgerwise sales team would: logging in, browsing scored companies,
opening reasons and their sources, drafting and editing an email,
approving or rejecting it, opening a conversation, and taking over a
thread. This caught UI breaks and dead ends that a build check cannot.

**Manual accuracy checks.** I reviewed drafted emails against each
company's stored source rows to confirm facts traced back to a real
source, and I tested the reply agent by hand on pricing questions,
opt-outs, and bot questions to confirm the rule guards fired.

What I can state with confidence is structural, not measured: email
facts are generated only from stored source rows, so an unsourced claim
has no path into a draft; opt-out language triggers permanent
suppression in code; and pricing questions route to a call rather than
an answer. These are enforced by guards, not by prompt wording alone.

What I cannot state is a pass rate. I have no measurement of how often
the reply agent books, escalates, or suppresses correctly across a fixed
test set. That number is what a client would ask for first, and building
that suite --- roughly 30 fixed replies covering pricing, opt-out, bot
questions, objections, booking intent, and ambiguity, reporting pass
rates per rule --- is my top priority with more time.

------------------------------------------------------------------------

## 8. What it costs to run

Development cost: \$0. Every tool was free or freemium --- ChatGPT,
DeepSeek, Claude, OpenCode, Tavily, Jina.ai, Gemini, Groq, Supabase,
Vercel, Resend, Cal.com.

Production cost at 30 leads per batch (order of magnitude):

-   30 companies Ã— roughly 15k tokens each across discovery, extraction,
    qualification, drafting, and replies â‰ˆ 450k tokens per batch.
-   At current API pricing that is roughly \$5--10 per 30-company batch,
    depending on model mix and how much of the work is page reading
    versus reasoning.
-   Supabase, Vercel, Resend, and Cal.com all sit inside free tiers at
    this volume. Resend's free tier (100 emails/day) covers 30 leads
    comfortably; Cal.com's free tier covers solo booking.

What would break first at scale: email deliverability (needs a verified
domain and warm-up, not just an API key), then Supabase free-tier row
and bandwidth limits, then inbound reply handling --- which needs a real
webhook rather than injection.

------------------------------------------------------------------------

## 9. Where the product stands, and what I would do next

The platform does the front of the funnel properly: research with
sourced facts, qualification with per-reason citations, fact-locked
email drafting, an approve/edit/reject queue, and a reply agent with
code-level rule guards and human handoff. The gaps are concentrated at
the back of the funnel and in polish.

### 9.1 Blockers against the brief (highest priority)

1.  **Real email sending.** Sending is simulated because I do not own a
    domain to verify with Resend. The integration is wired and swappable
    --- a verified domain makes it live. (Est. half a day.)
2.  **Booking.** Cal.com slot display works; the book-a-call action is
    not implemented, so a booking does not write to the calendar or the
    booked-calls screen. This is the largest functional gap against the
    brief. (Est. half a day to a day.)
3.  **A numbered reply test suite.** Rule compliance is the client's
    core requirement and I have not measured it as a pass rate. I would
    build \~30 fixed test replies and report results per rule. (Est. one
    day.)

### 9.2 Quality and scale (next)

1.  **Draft quality and context extraction.** Drafts are fact-locked and
    safe, but not yet as personal or as well-targeted as a human SDR's.
    I would improve how much signal is extracted from validated research
    before drafting. (Est. one day.)
2.  **Research throughput.** Research is thorough but slow per company.
    I would parallelize discovery and cache extractions to bring 30
    companies down to minutes rather than hours. (Est. one day.)
3.  **UI/UX polish.** The interface is functional and non-technical but
    visually basic. I would invest in layout, empty states, and clearer
    review ergonomics, since the brief weighs usability as heavily as
    the agent itself. (Est. two days.)

### 9.3 Beyond the brief (future)

1.  **Multi-tenant teams.** Today every user sees the same data.
    Isolating data per team would make the platform sellable to more
    than one client. Not required by the case --- scoped as future work.
2.  **Refactor for maintainability.** Consolidate modules built across
    four different AI agents into one consistent structure with shared
    types and a single rules file, so future features are cheaper to
    add.
3.  **Richer data exploitation.** Aggregate reporting over the pipeline
    --- reply rates by ICP segment, objection frequency, which triggers
    convert --- so the sales team learns from the data rather than only
    reading it.

### 9.4 On timing

I underestimated the front of the funnel and let research and drafting
consume the time booking needed. That was a prioritization error on my
part, not a technical blocker --- every remaining item above is
understood and scoped. Given additional time, items 1--3 are what I
would complete first, and I would want to focus a full uninterrupted
block on them rather than work in fragments around my current job.

### 9.5 A note to the reviewer

What is left is not exploratory --- it is scoped work I can execute. I
would rather say plainly that it is incomplete than present it as done.
The parts that exist are real, the sourcing is auditable, and I can walk
through any line of it.

------------------------------------------------------------------------

## 10. Additional work during the bonus period

The notes in this section were added after I wrote the earlier status
sections. Where they differ, these notes describe the more recent state of
the project.

After learning that I had been given 48 additional hours, I decided to use
Codex for the remaining work. In practice, I used about eight of those
hours: I had my regular job on both days and could only work from around
6 PM. A weekend would have given me a better opportunity to do further
development in a full, uninterrupted block.

### Bonus day 1 — email delivery

I started by asking Codex about ways to enable real email sending. I first
considered getting a free domain through DNSHE so I could configure an
email-sending service. Resend later confirmed that it requires a real,
verified domain and does not accept the freemium domain I had considered.
I therefore asked Codex to rework the sending workflow to use Brevo instead.

I created and configured the Brevo account, supplied the required API
configuration to the application, and tested the workflow using the Wild
Rye prospect. The test worked, and I checked Brevo's email logs as evidence
that the message had been processed.

### Bonus day 2 — data separation and booking

I added Supabase migrations for organization-level data separation, so one
organization's users should not be able to access another organization's
records. I then continued refining the calendar and booking feature.

### November 18 — interface and email quality

I made further UI/UX improvements and refined the email generation prompt
and source selection so the writer can use relevant verified information
more effectively and produce a more focused, natural email.

Real email sending now appears to be failing, although it worked the
previous day. I have not confirmed the cause; it may be a network issue or
a configuration problem. The earlier successful test and its Brevo logs
are evidence that the workflow worked before this failure. If I receive
more bonus time, I plan to investigate it over the weekend. I cannot work
on November 19 because I am scheduled at my job from 08:00 to 16:00.

Using Codex has been my best coding-agent experience so far. I installed
it in the terminal, connected my account, opened a terminal at the
repository root, and worked directly against the codebase. This made
implementation and follow-up changes straightforward; I could focus on
describing the work clearly instead of repeatedly packaging and sending
the repository to an AI tool.





