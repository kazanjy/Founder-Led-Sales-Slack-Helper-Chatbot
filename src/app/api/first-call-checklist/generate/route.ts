import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

// POST - Generate first call checklist from discovery questions and sales narrative
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get the latest discovery questions version with its sales narrative
    const latestDiscoveryQuestions = await prisma.discoveryQuestionsVersion.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        salesNarrativeVersion: {
          include: {
            answers: {
              include: {
                question: {
                  select: {
                    id: true,
                    category: true,
                    globalOrder: true,
                    question: true,
                  },
                },
              },
              orderBy: {
                question: {
                  globalOrder: "asc",
                },
              },
            },
          },
        },
      },
    });

    if (!latestDiscoveryQuestions) {
      return NextResponse.json(
        { error: "No discovery questions found. Please generate discovery questions first." },
        { status: 400 }
      );
    }

    // Parse the discovery questions content
    let discoveryQuestionsContent: {
      categories: Array<{
        name: string;
        description: string;
        questions: Array<{
          primary: string;
          followUps: string[];
        }>;
      }>;
    };

    try {
      discoveryQuestionsContent = JSON.parse(latestDiscoveryQuestions.content);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse discovery questions. Please regenerate them." },
        { status: 400 }
      );
    }

    // Build the Q&A inputs section from the sales narrative
    const narrative = latestDiscoveryQuestions.salesNarrativeVersion;
    const categoryOrder = ["Product", "Problem", "Solution", "Proof", "Business"];
    let qaInputsSection = "";

    for (const category of categoryOrder) {
      const categoryAnswers = narrative.answers.filter(
        (a) => a.question.category === category
      );
      if (categoryAnswers.length === 0) continue;

      qaInputsSection += `### ${category}\n\n`;
      for (const answer of categoryAnswers) {
        qaInputsSection += `**Q${answer.question.globalOrder}: ${answer.question.question}**\n`;
        qaInputsSection += `${answer.answer || "_Not answered_"}\n\n`;
      }
    }

    // Format discovery questions for the prompt
    let discoveryQuestionsSection = "";
    for (const category of discoveryQuestionsContent.categories) {
      discoveryQuestionsSection += `### ${category.name}\n`;
      for (let i = 0; i < category.questions.length; i++) {
        const q = category.questions[i];
        discoveryQuestionsSection += `${i + 1}. ${q.primary}\n`;
        if (q.followUps && q.followUps.length > 0) {
          for (const followUp of q.followUps) {
            discoveryQuestionsSection += `   - ${followUp}\n`;
          }
        }
      }
      discoveryQuestionsSection += "\n";
    }

    // Build the prompt for Chatbase
    const systemPrompt = `You are an expert B2B sales coach helping founders prepare for their FIRST DISCOVERY CALL with a new prospect.

## YOUR GOAL

Generate a comprehensive First Call Checklist that a founder can use to prepare for and execute their FIRST DISCOVERY CALL with a prospect. This is not a demo call or a closing call — it's the initial conversation where the founder needs to:
- Build rapport and establish credibility
- Understand the prospect's situation, pains, and goals
- Qualify whether there's a fit
- Set up the appropriate next step

## COMPANY CONTEXT

### SALES NARRATIVE:

${narrative.narrative}

### QUESTIONNAIRE INPUTS (Raw Q&A):

${qaInputsSection}

### DISCOVERY QUESTIONS:

${discoveryQuestionsSection}

## YOUR TASK

Generate a First Call Checklist for the company described above. Your checklist should include:

1. **Persona Reference Library** - Both organizational personas (types of companies) and individual personas (roles/titles) with their motivations, pains, objections, and emotional drivers. Use tables like the examples below.

2. **Pre-Call Planning Process** - Specific research steps, persona selection templates, and internal call objectives tailored to this company's market.

3. **Rapport & Introduction** - Icebreaker strategies, intro scripts with credibility framing, and agenda set language specific to this product/service.

4. **Discovery Section** - 5-8 must-ask questions with "why we ask this" explanations, persona-specific variants, follow-up prompts, and signals of pain to listen for. Include disqualification criteria.

5. **Opportunity Evaluation** - Post-call qualification criteria, next step options, and closing language for both fit and no-fit scenarios.

Make the checklist specific and actionable for this company's unique value proposition, target market, and competitive positioning. Include specific language, scripts, and questions they can use verbatim.

DO NOT wrap the output in code blocks. Just return the raw markdown.

---

## REFERENCE EXAMPLES

Below are two examples of excellent First Call Checklists. Study their structure, depth, and style, then create a similar checklist tailored to the company's specific context above.

### EXAMPLE 1: Julius (AI-native BI tool)

# Julius - First Call Checklist - Pre-Call Planning, Agenda Set, Discovery

---

## 🔹 PART 1 — Persona Reference Library

### A. Organizational Personas

| Organizational Persona | Description / Current State | Typical Needs / Goals | Common Challenges |
|---|---|---|---|
| Startup Engineering / Growth Leader | No data team. Eng team gets insights for themselves or marketing/GTM/execs | Save time. Ask questions that otherwise wouldn't. Stop distracting eng | No data best practices yet. Very resource (time) constrained. Often don't want to even get on a call. |
| Head of Data at startup | Very small data team. Likely 1-5 people. Almost entirety of time spent answering ad-hoc questions. Analysts likely working as data engineers in some capacity. Probably not decision maker. | Overwhelmed by combo of ad-hoc requests, needs for reporting. Data team is central for company goals but rarely has time to work on strategy. | Likely juggling multiple data tools. Looking for ways to help offload ad-hoc requests, but no time to build out a solution for handling. |
| Head of Data at Scale Up or Larger | Likely has a larger team or multiple data teams. Combination of tools. Can be decision-maker for smaller deals, likely not for larger deals. | Team handles tons of tickets. Internal data initiatives take a long time. Adoption of tools is often difficult to organize. | Adopting tools takes more time. Often looking for trials, start small and expand. Teams have less urgency. More need for governance / risk assurance. |

### B. Individual Personas

| Role / Persona | Motivation / Success Metric | Common Pains | Objections / Concerns | Emotional Driver |
|---|---|---|---|---|
| Head of Data | Make sure execs can get answers when needed. Lowering ticket response time. | Lots of ad-hoc requests. Little time for strategic initiatives. Underresourced | Have invested time into other tools. Have to get buy-in from others. Often don't have authority for purchase decisions. Concerned with adoption rate of tools. Also concerned with accuracy of results - "What if people go run with the wrong answer - too much risk" | Want to work on the important problems. Want a "seat at the table" with leadership. |
| Data Analyst | Looking to offload or speed up boring or repetitive tasks. Do work that is more impactful. | Endless tickets. Often times tickets require a follow up. Often end up answering the same question a number of times across tickets. | Don't want to have to do more work to set up tools. Don't want to maintain data artifacts in different places. | Save time on tickets, time on repeated analysis, time wasted in meetings to go over answers. |
| Data Manager | Looking to enable team. Speed up ability to get thru tickets or allow for expansion into other initiatives. | Data sits in many tools. Different needs from different parts of orgs / requests. | Need buy in from other teams. Why would they want to use over other general AI tools? | Unblocking direct reports, making BI simpler for execs. |
| Head of Growth | Use AI to find, test, iterate on key expansion pathways | Growth team often is non-technical. Don't always know where to go for answers. Takes a long time to get responses | Have other tools available. Worried about non-technical users getting wrong answers. | Want to meaningfully drive impact and top-line for company. Find data that helps understand where growth patterns and retention points are. |

---

## 🔹 PART 2 — First Call Checklist

### 1️⃣ Pre-Call Planning Process

**Which organizational persona is this?**
Startup / scaleup? Otherwise?

**Which human persona is this?**
Manager vs. IC?

**Likely to own the budget?**

**Research the prospect**
- Does anyone at the company (domain) use Julius already?
- How did they find Julius?
- Are there connection points we can start a conversation with - either with primary point of contact or anyone else on call?
- Any hints as to what their primary motivations are?

#### Persona Selection for This Call

**Organizational Persona for This Call:**
- Type: TBD
- Current state / situation: TBD
- Hypothesized needs or challenges: TBD

**Individual Persona(s) for This Call:**
- Role(s): TBD
- Seniority and experience: TBD
- Primary motivations or success metrics: TBD
- Likely objections or blockers: TBD

**Internal Call Objectives** (what success looks like for a first call):
1. Find out if they have the problem that we solve for
2. Find out if they are the right person to be talking to - if not then who?
3. Figure out if there's a way to make this a quick process — Are they willing to push and jump thru hoops? Or are they just fishing?

---

### 2️⃣ Rapport & Introduction

**Your Rapport & Intro Steps (3 mins):**
"Hey everyone, good to meet you. Where are you calling in from today?"
Use connection point from pre-call research if possible

"I'm Drew and I work in business development here at Julius. Julius is the AI native BI tool for teams who have ad-hoc and repeatable business intelligence needs. We help teams transform their culture from data-curious to data obsessed and allow non-technical users to ask questions and easily get answers from data in a governed fashion."

"Over the past 2 years at Julius we have built a customer base of over 2 million users and over 10k companies, including teams like Nvidia, Toast, and SimpliSafe."

**Agenda Set Language** *(1 min)*:
"I know your time is valuable. And if it sounds good to you, I think a good goal for us today is to figure out if Julius is a good fit for you and your team."

"If it turns out that Julius seems like an appropriate way for your company to go from A to B when it comes to optimizing ROI and creating actionable business insights out of your data, then at the end of the call we'll discuss the most effective way to proceed."

"Does that sound okay to you?"

---

### 3️⃣ Discovery Section

**Discovery Question List (15 mins):**
- "Where does your data live today?"
  - If no DWH: "What apps own the data that you care about?"
  - If google sheets: "Is it static or does it update?"
    - If static: "Is that ideal? Would it be useful to have this update dynamically?"
- "What burning unanswered questions would you like answered?"
- "What do you use for BI now?"
- "Do you have a semantic layer today?"
- "Can you take me through how an ad-hoc question gets answered now?"
- \\[NEED/AUTHORITY\\] "Who else shares these pain points? Is it just your team or is it other teams?"
  - "How big is your team?"
  - "How big are other teams?"
- \\[BUDGET/AUTHORITY\\] "If it turns out that we can solve your problem effectively, is there anyone else we would need to loop in to make sure your team is able to use Julius?"
  - "Does your team own the budget for tools like this?"
- \\[AUTHORITY\\] "Have you adopted any other AI tools as an organization? What did that look like?"
- \\[NEED/TIMELINE\\] "What makes this a need now? Has anything changed that makes this more pressing?"

**Signals of Pain or Opportunity to Listen For:**
- **"Self-serve Analytics"** - team is tired of answering ad-hoc questions, wants to remove time spent on this
  - Follow up Prompt: "Have you tried to implement anything like this to date?"
- **Company over 100 people and have 5 or less "data people"**
  - Follow up Prompt: "Are 'data people' the only ones that are able to answer data questions? Is this a bottleneck for the company? How much value do you think you're leaving on the table?"
- **"Skill gap in prompt engineering"**
  - Follow up Prompt: "Have you done any internal AI training to date?"
- **"ChatGPT hallucinations"**
  - Follow up Prompt: "How do you deal with AI hallucinations today?"

**Closing (if not DTF):** "It sounds like this might not be the right fit. Please feel free to check in with us whenever you guys are looking to save time and resources with data insights."

**Closing (if DTF):** "It sounds like this might be a good fit. I know we only have several minutes left but I think our best use of those might be to get your data connected and start answering some questions! How does that sound?"

---

### EXAMPLE 2: Synthesis (AI-powered systematic review verification)

# Synthesis - First Call Checklist

## Part 1 — Persona Reference Library

### A. Organizational Personas

| Org Persona | Description / Current State | Typical Needs / Goals | Common Challenges |
|---|---|---|---|
| CRO / HEOR Consultancy | Medical comms / HEOR consultancies (PharmaGenesis, Fiecon, OPEN Health, Certara, Mtech Access, Genesis Research). Produce SLRs as core service, billing $50K-$150K per review. Teams of ~10 junior scientists + ~3 senior adjudicators. Revenue capped by reviewer headcount — literally turn away projects. | Win RFPs with AI narrative, increase throughput without hiring, defend quality to pharma clients, publish validation work for scientific credibility | AI reduces billable hours (hourly billing tension), tool fatigue from evaluating multiple AI platforms, regulatory uncertainty about AI in submissions, AI-native entrants pricing at $25K |
| Pharma / Biotech / Medtech | Companies with internal HEOR / Market Access teams (Pfizer, Novartis, AstraZeneca, Chiesi). Spend $2M-$10M per drug on market access evidence. Full submission package (SLR + NMA + model) costs $150K-$500K. Outsource SLRs to CROs for "McKinsey defense." | Prevent HTA rejection, scale evidence production for IRA/JCA deadlines, reduce dependence on CRO timelines, verify CRO output quality | Volume multiplication (drug x indication x comparator), 85% of AI pilots fail, procurement friction, long decision cycles, McKinsey defense mindset |

### B. Individual Personas

| Role / Persona | Motivation / Success Metric | Common Pains | Objections / Concerns | Emotional Driver |
|---|---|---|---|---|
| CRO Scientific Director (Research) | Methodology rigor, publications, review quality. Zero HTA pushback on reviews they supervised. | Error-prone manual process, reviewer fatigue at paper #3000, throughput ceiling, can't hire fast enough | "How do we defend AI to regulators?" "We need to be able to defend every step." | Protect scientific reputation. Be the person whose methodology is unassailable. |
| CRO AI/Innovation Lead | Board-ready AI wins, competitive positioning, peer-reviewed publications with their name. | Tool evaluation overload ("20 tools, no way to know which is best"), no clear winner, pilot purgatory, vendor hype without substance | "Many tools use same LLMs — what's different?" "AI needs not to be faith-based." | Look like the person who modernized the org. Separate signal from noise. |
| Pharma HEOR Director (Research) | HTA acceptance rate, evidence package quality, clean submissions on first pass. On-time CRO delivery. | CRO turnaround time, rework from rejections, PICO multiplication (7 products x 2-4 PICOs = 14-28 evidence packages by 2028), fire drills | "Our CRO handles this — why change?" "Adding complexity to an overloaded process." | Never have an HTA rejection on their record. Be the one who caught the problem before it hit regulators. |
| Pharma AI Task Force | Demonstrable AI ROI, pilot-to-production conversion. Board-ready wins. | 85% pilot failure rate, no tangible results to show board, running around with a hammer looking for nails | "We've tried AI tools before." "We need to see ROI before committing." | Prove AI investment was worth it. "85% of AI pilots fail. Yours didn't." |

### C. Background Modifiers

| Background | How to Adjust |
|---|---|
| Pure Research | Methodology, accuracy, PRISMA. No AI jargon. Show outputs, not architecture. |
| Research + AI literate | Can go deeper on how the AI works. Powerful champion — validates both sides. |
| Pure AI/Tech | Architecture, models, DSPy. May need education on why PRISMA matters. |
| AI + Research background | Best contact. Understands both worlds. Can translate internally. |
| Synthesis/HEOR domain expert | Knows SLR workflow cold. Less context-setting. Jump to workflow fit. |

---

## Part 2 — First Call Checklist

### 1. Pre-Call Planning Process (15-30 minutes before call)

**THE BIG QUESTION: WHAT IS YOUR ANGLE FOR THIS ORG PERSONA AND HUMAN PERSONA?**

### Pre-Call Research Steps
- **Lead source & context:** How did they find us? ISPOR? Validation paper? LinkedIn? Referral from whom? What did they say in the inquiry?
- **Org persona identification:** CRO or Pharma? Check company website — look for "HEOR", "evidence synthesis", "market access" in services.
- **Human persona identification:** LinkedIn title → map to Research vs AI persona. Check seniority, tenure, publication history.
- **Background modifier:** Pure Research, Research + AI literate, Pure AI/Tech, AI + Research, or HEOR domain expert?
- **Pain point hypothesis:** Based on org type + persona, form a hypothesis. CRO: volume pressure? Competitive threat at $25K? Pharma: EU JCA 2028 deadline? PICO multiplication?
- **Social proof selection:** Which partners/validation work is most relevant?
- **Anticipated objections:** Based on persona, what will they push back on?
- **Exit intention:** What's the ideal next step? Free verification? Paid POC? Meet another stakeholder?

### Scratchpad Template (fill per call)
- Lead source: ___
- Org persona: CRO / Pharma
- Human persona: Research / AI / Executive
- Background modifier: Pure Research / Research+AI / Pure AI / AI+Research / HEOR Expert
- Pain point hypothesis: ___
- Social proof to use: ___
- Anticipated objections: ___
- Exit intention: ___

### Internal Call Objectives (persona-specific success criteria)
- **CRO x Research:** Validate scientific credibility → get them to acknowledge human error problem → secure agreement to re-run completed SLR
- **CRO x AI:** Validate technical architecture → understand commercial model fit → map decision chain to Innovation Director/Board
- **Pharma x Research:** Understand HTA submission process → position as CRO verification layer → identify current CRO relationships
- **Pharma x AI:** Frame as low-risk, board-ready AI win → connect to HEOR team quickly

**Universal success criteria (all personas):**
1. Identify 2-3 critical pains (with quantification if possible)
2. Confirm decision process (who approves, budget authority, timeline)
3. Qualify volume (10+ SLRs/year threshold)
4. Secure a specific next step with a clear deliverable and a calendar commitment

---

### 2. Rapport & Introduction (<5 min)

### Rapport / Icebreaker
Reference their published work, ISPOR presentation, shared academic community, Cochrane connection. NOT generic LinkedIn small talk — show you've read their papers.

**Transition to business within 2-3 min:**
- "How long have you been doing systematic reviews at [Company]?"
- "I saw you joined [Company] last year — what brought you there?"

### Intro Script (persona-matched credibility framing)

**For Research personas:**
"I'm [Name], co-founder of Synthesis. We're systematic review researchers ourselves — built HubMeta for 6,000+ researchers, published in Systematic Reviews Journal. We've spent the last two years building AI that works alongside human reviewers on SLRs — and we just published the largest validation study in the space: 30,000 documents, 20,000 datapoints, where AI caught 177 studies that human reviewers missed. We're working with WHO and surgical societies on active research projects."

**For AI personas:**
"I'm [Name], co-founder of Synthesis. My co-founder and I are core contributors to DSPy at Stanford NLP — that's the prompt optimization framework we use under the hood. We've built a multi-agent verification system specifically for SLRs and validated it on 30K+ documents. Our preprint is under review at Science Advances."

### Agenda Set Language
"Here's what I'd like to do today — I want to learn about how you're currently handling [SLRs / evidence synthesis / screening and extraction], and if there's a fit, I'll show you some of our validation results and how the tool works. If it seems interesting, we can talk about a small verification project using your own data. And if at the end it doesn't seem like a fit, that's totally fine too — I'll give you back your time. Does that work?"

"But before I get into anything — is there something specific you wanted to discuss today?"

---

### 3. Discovery Section (~15-20 min)

### Must-Ask Core Questions (5 non-negotiables, every call)

**1. "Walk me through how you do a systematic review end-to-end — who does what?"**
Why we ask this: Maps their workflow, reveals pain points, identifies where Synthesis fits.
- CRO variant: "Walk me through a typical project from when the pharma client sends you a PICO to when you deliver the evidence table."
- Pharma variant: "Walk me through how you manage an SLR with your CRO — from defining the PICO to receiving the final deliverable."

**2. "How many SLRs or TLRs do you produce per year, and is that volume changing?"**
Why we ask this: Qualifies volume (deal size), reveals regulatory pressure.
- Follow-up if volume is increasing: "What's driving the increase? Is it new indications, regulatory requirements, or something else?"

**3. "What's your experience with AI tools for literature review so far?"**
Why we ask this: Determines sophistication, reveals competitor exposure, surfaces past failures.
- If they've tried tools: "What worked and what didn't? What made you move on?"
- If they haven't: "What's held you back?"

**4. "When a reviewer misses a study or makes an extraction error, how do you typically find out?"**
Why we ask this: Exposes the quality control gap — THE core problem Synthesis solves.
- CRO follow-up: "Has that ever cost you a client relationship or an RFP?"
- Pharma follow-up: "Has that ever happened on an HTA submission? What was the fallout?"

**5. "What happens to your timeline and team when you get a new regulatory requirement — like an additional PICO or a submission rejection?"**
Why we ask this: Reveals the real cost of the problem — the fire drill, the rework, the scramble.

### Signal Check After Discovery
Before proceeding to presentation, assess:
- **Do they have pain?** Did they describe a specific problem that Synthesis addresses?
- **Can they buy?** Do they have budget authority, or a clear path to someone who does?
- **Is there urgency?** Active project, upcoming deadline, competitive pressure?

If yes to all three → move to presentation. If missing one → dig deeper or qualify out gracefully.

### Disqualification Script (if they don't have the pain)
"You know what, [name] — based on everything we just talked about, I don't think what we're up to is going to be super helpful for your team right now. We mainly help organizations that are producing SLRs at volume and need a quality verification layer. I know you're busy, and I don't want to waste your time on something that isn't a fit. I'm happy to send over our validation paper and some slides — and if things change down the road, I'd love to reconnect. Does that sound fair?"

---

### 4. Narrative Positioning & Presentation Framing (~5-10 min)

### Elevator Pitch (tailored to discovery answers)
"Synthesis is AI-powered systematic review verification. What we do is run your SLR through a multi-agent AI system — extractors, verifiers, and judges that cross-check each other — and you get back a complete discrepancy report showing where AI and humans disagree, with page-level citations for every decision. What this means is your senior scientists can focus on adjudicating real disagreements instead of re-reading 3,000 papers. And the big thing — in our validation study, AI was more accurate than human reviewers: 97.2% sensitivity vs 91.6%, and found 177 studies that humans missed."

### Connecting Discovery to Value (the bridge)
"Based on what you shared about [pain from discovery], this is exactly the kind of situation where..."

| Persona Pairing | Bridge Language |
|---|---|
| CRO x Research | "...having a verification layer catches the errors your dual-reviewer process misses. Your methodology becomes bulletproof." |
| CRO x AI | "...having published validation data gives your board something concrete, not another pilot. This is peer-reviewed, not a vendor demo." |
| Pharma x Research | "...you can verify your CRO's output without re-doing the entire review. Think of it as QA on a $150K deliverable." |
| Pharma x AI | "...the validation study means this isn't faith-based — it's evidence-based. Low-risk AI win your board will understand." |

### Strategic Framing Rules (non-negotiable)
- **Never say "cost reduction."** Say "win more business" (CRO) or "prevent rejection" (Pharma).
- **Lead with accuracy** (97.2%), mention speed (250x) secondary.
- **Frame AI as "insurance" or "risk reducer."** Position as augmentation: "Your process, plus a verification layer."

### Social Proof (persona-matched)
- **For CROs:** "We're working with PharmaGenesis on a multi-client validation study targeting a Nature/Science publication."
- **For Pharma:** "We're collaborating with Brown University and Monash on an NIH-funded living meta-analysis of 3,000+ RCTs."
- **For Academics:** "Our co-authors include researchers from Carnegie Mellon, Johns Hopkins, and VU Amsterdam."
- **For AI skeptics:** "The WHO is using this for their psychotherapy database — they wouldn't if it didn't meet their standards."

---

## END OF REFERENCE EXAMPLES

Now generate your First Call Checklist for the company described above, following the structure and depth demonstrated in these examples.`;

    console.log(`Sending first call checklist prompt: ${systemPrompt.length} chars`);

    // Call Chatbase
    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(systemPrompt);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate first call checklist. Please try again." },
        { status: 500 }
      );
    }

    // Clean up the response - remove any code block wrappers
    let cleanedResponse = aiResponse.trim();
    if (cleanedResponse.startsWith("```markdown")) {
      cleanedResponse = cleanedResponse.slice(11);
    } else if (cleanedResponse.startsWith("```")) {
      cleanedResponse = cleanedResponse.slice(3);
    }
    if (cleanedResponse.endsWith("```")) {
      cleanedResponse = cleanedResponse.slice(0, -3);
    }
    cleanedResponse = cleanedResponse.trim();

    // Create the version record
    const version = await prisma.firstCallChecklistVersion.create({
      data: {
        userId: user.id,
        discoveryQuestionsVersionId: latestDiscoveryQuestions.id,
        content: cleanedResponse,
      },
    });

    // Update merge variable with the first call checklist
    await prisma.gtmVariable.upsert({
      where: {
        userId_mergeField: {
          userId: user.id,
          mergeField: "FIRST_CALL_CHECKLIST",
        },
      },
      update: {
        value: cleanedResponse,
      },
      create: {
        userId: user.id,
        mergeField: "FIRST_CALL_CHECKLIST",
        name: "First Call Checklist",
        value: cleanedResponse,
        isDefault: false,
      },
    });

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        content: cleanedResponse,
        discoveryQuestionsVersionId: version.discoveryQuestionsVersionId,
        createdAt: version.createdAt,
      },
    });
  } catch (error) {
    console.error("Error generating first call checklist:", error);
    return NextResponse.json(
      { error: "Failed to generate first call checklist" },
      { status: 500 }
    );
  }
}
