import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { sendToChatbase } from "@/lib/chatbase/client";

// POST - Generate sales narrative from questionnaire answers
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get all enabled questions
    const questions = await prisma.salesNarrativeQuestion.findMany({
      where: { enabled: true },
      orderBy: { globalOrder: "asc" },
    });

    // Get user's latest answer for each question
    const latestAnswers = await prisma.$queryRaw<
      Array<{ questionId: string; answer: string; createdAt: Date }>
    >`
      SELECT DISTINCT ON ("questionId") "questionId", "answer", "createdAt"
      FROM "sales_narrative_answers"
      WHERE "userId" = ${user.id}
      ORDER BY "questionId", "createdAt" DESC
    `;

    const answerMap = new Map<string, string>(
      latestAnswers.map((a) => [a.questionId, a.answer])
    );

    // Check if at least some questions are answered
    const answeredCount = latestAnswers.length;
    if (answeredCount === 0) {
      return NextResponse.json(
        { error: "No answers found. Please answer at least some questions before generating." },
        { status: 400 }
      );
    }

    // Build the answers summary for the AI
    const categoryOrder = ["Product", "Problem", "Solution", "Proof", "Business"];
    let answersSummary = "";

    // Extract product name for use in prompt
    const productQuestion = questions.find((q) => q.category === "Product");
    const productName = productQuestion ? answerMap.get(productQuestion.id) || "the product" : "the product";

    for (const category of categoryOrder) {
      const categoryQuestions = questions.filter((q) => q.category === category);
      if (categoryQuestions.length === 0) continue;

      answersSummary += `## ${category}\n\n`;

      for (const q of categoryQuestions) {
        const answer = answerMap.get(q.id);
        answersSummary += `**Q${q.globalOrder}: ${q.question}**\n`;
        if (answer) {
          answersSummary += `${answer}\n\n`;
        } else {
          answersSummary += `_Not answered_\n\n`;
        }
      }
    }

    console.log("Sales narrative answers summary length:", answersSummary.length, "characters");

    // Build the prompt for Chatbase
    const systemPrompt = `You are helping a founder create their sales narrative following the "Founding Sales Sales Narrative" approach by Pete Kazanjy.

The product/service name is: ${productName}

Based on the questionnaire answers below, generate a compelling sales narrative and product descriptions.

## THE FOUNDING SALES SALES NARRATIVE FORMAT

The Sales Narrative is a flowing prose document (NOT bullet points) that weaves the answers into a cohesive, persuasive story.

### CRITICAL REQUIREMENT: SECTION HEADERS ARE MANDATORY

You MUST include bold section headers at the start of each section. These headers are NOT optional - they are a defining characteristic of the Founding Sales format. Without them, the output is incorrect.

Each section MUST begin with its header in bold, exactly like this:
- **What's the problem?**
- **Who has the problem?**
- **What's the cost of not solving the problem?**
- **How is this currently solved? Why doesn't that work?**
- **What has changed?**
- **How does it work?**
- **How do you know it's better?**
- **Pricing**

The narrative must have 8 clearly labeled sections. After each bold header, write 1-3 paragraphs of flowing prose for that section.

Use an engaging, conversational tone with urgency around the problem. Include specific numbers and metrics throughout.

## EXAMPLES

### The TalentBin Narrative

**What's the problem?** Technical recruiting is really hard! Finding software-engineering talent that has the skills that your organization requires, and then engaging with them to get them to consider your organization, is a tough problem.

**Who has the problem?** It's something that makes the lives of technical sourcers, recruiters, and recruiting managers rough.

**What's the cost of not solving the problem?** If they don't solve the problem, they may have to pay large sums of money to recruiting agencies—25% of a first-year salary of $125,000 or more. Otherwise they don't hire on schedule, and that impacts the ability of their organizations to ship software on time, and make revenue!

**How is this currently solved? Why doesn't that work?** Yes, you can use things like job boards or LinkedIn, but the problem is that unemployment is so low in software engineering that very few engineers are actively looking for jobs. And because most people don't really pay attention to LinkedIn or update their profiles, software-engineering profiles have a tendency not to exist, or to be missing the skill information that indicates that the engineer in question would be a good fit. Not to mention the fact that there are hundreds of thousands of recruiters on LinkedIn messaging every engineer they can find, and that creates tons of noise to cut through.

**What has changed?** But the good news is, the Internet has undergone some amazing changes of late to help make finding and engaging with these potential hires much easier and more effective. Because people are spending so much more time online, day in and out, on social sites like Twitter, Facebook, and Meetup and professional networks like GitHub and Stack Overflow—and because of the general move toward the digitization of work materials—there are reams and reams of information available. If properly leveraged, that material can help recruiters find talented individuals based on the activity they engage in online—for instance, tweeting about iOS development, being a member of an Android Meetup, participating in email lists about Java, and so on.

**How does it work?** TalentBin scoops up all the information that individuals leave as digital fingerprints of their professional selves, analyzes it, and turns it into profiles for these individuals, with skill details and contact information. Then we let recruiters search and review the profiles and reach out to folks.

**How do you know it's better?** Because TalentBin makes use of these mountains of "implicit" professional activity, it solves the problem of finding individuals who are not searching for jobs, not present in job board resume databases, and undiscoverable on LinkedIn due to their thin profiles. For instance, for a typical search like "Ruby on Rails" in the San Francisco Bay Area, TalentBin returns 5x the number of results compared to LinkedIn Recruiter. Moreover, 60% of these profiles have personal email addresses, which are so, so much better for engaging candidates. Recruiter open, click, and response rates using TalentBin provided personal email addresses are 3x-5x better than generic InMail outreach. And while the raw statistics tell the story, the hundreds of customers TalentBin has amassed—who have hired thousands of technical staff with the solution—tell the story even better. Not to mention the awards, press, and analyst accolades TalentBin has won since entering the market.

And all of this is available to you for **$6,000 per user, per year**. That includes unlimited requisitions, searches, and profile views, and unlimited email sends. Compare this to $8,000 for a LinkedIn Recruiter account with inferior technical candidate search recall, capped at a hundred InMails a month. It's a total steal!

### The Salesforce Narrative

**What is the problem? Who has it?** Being a B2B sales rep is tough! You have to manage dozens of concurrent conversations, follow up at the right time, and not drop any balls. So too with being a sales manager. You have to make sure that your team is engaging in high activity—but also the right activity—and keep track of potential issues, while forecasting how your revenue achievement will end up for the quarter.

**What is the cost of the issue?** And this is serious business. If a rep drops a ball, forgetting to follow up with a prospect at the right time or neglecting to send a proposal as promised, it can mean tens or hundreds of thousands of dollars of lost revenue. Moreover, from an efficiency standpoint, if reps aren't sufficiently productive, they're missing out on potential deals and conversations. And for sales managers, not being able to manage the activity levels of staff, identify weaknesses, and forecast accurately could mean leaving problems unaddressed, which can turn into hundreds of thousands of dollars of short fallen targets. And that could mean missed quarters and stock impacts. It's no joke.

**How is this currently solved?** For how important customer-relationship tracking and management is, it's amazing how poorly it's generally done. You have reps either living out of their email and calendars or using ancient, clunky contact managers like Act! or GoldMine, or last-generation CRMs made by Siebel that look like something out of Tron.

**Why don't current solutions work?** The problem with these approaches is that email and calendars are not designed for tracking customer relationships, and make it more likely for very costly balls to be dropped. Last-generation CRM systems require reps to be in front of their computers, dialed into a VPN. And even if they are, those systems are extremely clunky and hard to use—creating more time and bookkeeping overhead rather than actually enabling reps to sell more, faster.

**What has changed?** However, with the rise of the Internet, now the power of modern, usable, always-accessible CRM can be available to reps wherever they are, whenever.

**How does it work?** Salesforce provides a modern, next-generation CRM that is accessed through the browser, connecting reps to their important deal information quickly and easily. And because it's software delivered as a service, the latest and greatest innovations in rep-efficiency features are available to all users, all at once, rather than requiring IT to upgrade the on-premise CRM system. And because web technologies make for easy interoperability, Salesforce has a massive partner ecosystem of amazing add-on tools that offer all manner of efficiency benefits.

**How do you know it's better?** Because the software is available to reps wherever and whenever via a browser, and is much more usable, you get reps who are logging in and updating opportunities and pipelines as much as 3x–10x as often as on traditional systems. That not only reduces the potential for dropped balls—as you can see by the 20%–50% increase in win rates for reps who adopt Salesforce—but also makes for more accurate forecasts on a rep and sales manager basis. We've seen a 30%–50% reduction in missed forecasts for managers whose teams use Salesforce. All of which has resulted in Salesforce being the most lauded CRM solution on the market, consistently in Gartner's Magic Quadrant for CRM, and gaining tens of thousands of customers.

## REFERENCE: FOUNDING SALES CHAPTER ON SALES NARRATIVES

This is the chapter from Founding Sales that discusses how to write a sales narrative.

The first step on the road to a repeatable, scalable sales process is to build your narrative. That is, craft the "story" you will be presenting to your would-be customers, which will eventually take the form of slides, email templates, spoken messaging, website copy, videos and so forth. Because before you start creating those artifacts, you have to have the framework.
Your sales narrative will likely be a recasting of other content your organization may already have documented. For instance, if you already have concrete product narrative, posing customer pain and your proposed solution, then turning it into a customer-facing sales narrative shouldn't be too hard.
"It's hard for small local businesses to acquire new customers. So we fix that by aggregating new customers with the help of compelling coupon offerings."—Groupon
"Salespeople have to keep track of lots of concurrent conversations, and end up dropping balls and losing revenue. So we make software that helps them avoid those errors and book more revenue."—Salesforce
There will be a circular feedback loop between the product narrative and your sales narrative as it meets the market and either fails, succeeds, or does a little of both. So this shouldn't be looked at as something set in stone, but rather as a hypothesis that will change over time. But you still have to have a coherent rough draft to start.

### What is the Right Formation?

While there are a variety of ways to construct your customer-facing narrative, for early-stage, new-technology sales organizations, I'm a fan of the "problem-solution-specifics" narrative framing.
That is, identify the problem, who has it, how it is currently solved (or not), and why that's unsatisfactory, followed by what has changed to make this problem solvable in a new way, what that means for the problem in question, how your new solution works to solve this problem, and what the quantitative and qualitative proof points are that validate this line of argumentation. Those will be the core components of a sales narrative, along with potential additions, like competitive messaging (why is your proposed approach better than other proposed approaches?), and all manner of embellishments (like digging into the specifics and features of your solution).
If this sounds like a fundraising pitch, you shouldn't be surprised. A funding pitch typically has all of the same trappings, plus macroeconomic rollups of certain parts. For example, "How many people have the proposed problem and what are they willing to pay to solve it" would be a market-sizing exercise, which isn't relevant to a customer-facing sales pitch but requires the same precursory information.
Framing your narrative in this way will also be helpful as you develop your marketing collateral, in that each part builds on the part before. Think of it as an inductive approach: If someone disagrees with your framing of the problem, great, it's the first thing you've discussed; you can focus on that (or end the interaction), rather than rehearsing other parts of your pitch that are not relevant. Or if the person you're talking to agrees that this problem exists, but not that he has it, again, great; you can save time by not pitching someone who doesn't care. Narrative framing nicely complements the efficiency mindset that should pervade sales, as covered previously in Chapter 1 on Sales Mindset Changes.

### Building a Cohesive Narrative

So let's walk through these individual components. Once you understand how to think about them—and have them mapped out—you can put it all together into a cohesive narrative.
What is the problem?
Who has the problem?
What are the costs associated with this problem?
How do people currently solve this problem? Why do current solutions fail?
What has changed that enables a new solution?
How does the new solution work?

### What is the problem?

You need to identify the business pain you're seeking to solve, as crisply as possible, so your audience can quickly evaluate whether what you're talking about is relevant to them.
For instance, in the case of TalentBin, "Technical recruiting is hard. It's hard to find software engineering talent that has the relevant skills, and even if you can find them, getting in contact with them is tough. And once you've found and contacted talent, keeping on top of all those conversations can be a huge time suck fraught with dropped balls, all leading to slower hire times and raised cost of hire."
Or in the case of, say, Groupon, it might be "Finding new customers for your local business is hard. With all the time you spend running day-to-day operations, who has time to figure out how to drive new business through the door? But if you don't grow your customer base to find new, repeat customers, how can you get off the hamster wheel and grow your business?"
Or in the case of Salesforce, it might be "B2B sales is hard. You're working on a million things at once, and it can be really easy to lose track of deals and let things fall through the cracks, which hurts your ability to reach your quota. And as a manager, it's hard to know if your teams are working on the right things, if their efforts are directed toward the highest-value opportunities, and how they're tracking against their goals. Which leads to underperforming teams and missed forecasts."
Or in the case of HubSpot, it might be "Being an online marketer is hard. Sales wants more leads. And there are so many things you could be spending your time on, but you're constantly pulled in lots of directions, many of them not particularly fruitful. Really, you just want an all-in-one solution that can help you do the right things, automatedly, and help you keep track of your success.
Or in the case of Zendesk, it might be "Being a support agent is hard. You have all these people running into issues with the product you're supporting and emailing you, needing help. You want to help them all, but with so many concurrent conversations happening, it can be hard to keep up, and keep balls from being dropped, which leads to unhappy customers who stop paying. Moreover, so many of the questions are the same, again and again, and answering those repetitive questions keeps you from helping the people who need more advanced guidance. As a support manager, you want to help your teams be as efficient as possible and not drop balls, so they can spend their time delighting customers, rather than typing out the same answer."
There may be particular nuances and levels to the problem in question. In the case of TalentBin, for example, more advanced sales conversations addressed discovery, contact, and management of recruiting conversations too. In the case of Salesforce, there's a distinction to be made between the problem individual reps have and the problem sales managers have. But at least identifying the baseline is key.
A good test of whether you've got it is to pose the problem statement to someone in the industry. You're in good shape if you say, "Have you encountered this?" and she not only says yes, but can then proceed to a deeper conversation about it.
Know, and be able to articulate, the problem you're addressing.

### Who has the problem?

Equally important is identifying the person who has the problem. We've already touched on this a little bit, since the person with the problem will often pop up in the problem statement—they're somewhat hard to separate, and that's fine. But you should know the players who are navigating, or trying to manage, the business hassles you're tackling.
This is both so you have a strong sense of who you should be addressing with this narrative, and so that when you are addressing someone, they themselves can make the same evaluation. Are you talking to the right person, and do they want to listen to what you have to say?
In B2B software and sales, there is generally a specific person, or group of people, whose job it is to solve the problem you're proposing. Identifying them is the goal here. There can be more than one person, and generally as an organization gets larger what might have been the problem of one person, or a slice of a person, becomes the distributed problem of more people. The collective "business speak" for this is "stakeholders," but you want to focus on those who are purely responsible for solving the business pain. If the person in question can say, "Well, that's not really my job," then you know you have the wrong person. And you should understand the different players in your narrative.
You might say, "Well, the CEO is the one who has this problem, because the buck stops with her." But generally speaking, you want to be talking to the people who have specific functional responsibility for resolving the problem you're addressing.
So in the case of TalentBin, for example, the people who have the problem being solved would be recruiters who are responsible for filling individual requisitions (ideally just the technical ones) and recruiting managers who are responsible for providing talent to the other parts of the business—like engineering managers and the VP of Engineering. But the people in those other parts of the business, while impacted by the problem, aren't precisely responsible for its solution (except in very small organizations where you don't yet have separation of responsibilities).
For, say, Zendesk, the most direct stakeholders would be the Head of Support or Customer Success and the individual customer service people who solve customer issues.
For a CRM solution, focused on rep efficiency and managerial insight, this would be a Manager, Director, or VP of Sales Operations, or, absent that, the sales leader who is most concerned about sales efficiency as supports revenue growth.
A good rule of thumb for targeting the right stakeholders is to look for the person who has control of the budgetary resources allotted to resolve the pain point you solve. Or, alternatively, the person who spends meaningful amounts of time (i.e., labor resources), day to day, resolving that pain point.
As organizations get larger, you see more specialization and focus with regard to who would be the owner of a given business pain, and thus ought to be the target of your message. For instance, in a small organization that has a single sales rep, with the CEO focused on sales performance, those would be the individuals to target for a sales automation solution. As an organization gets larger, you might have a Director of Sales managing six sales reps, and that Director of Sales would be your target. And as that organization get larger still, the pure responsibility for sales enablement and operation may be specifically split off into its own role, with titles like Sales Operations Manager, Director, and so forth, at which point, those people would be your best target.
Relatedly, and we'll get into this more when we talk about account qualification, just because there's someone at an organization who addresses your problem, that doesn't mean that the organization is necessarily qualified for your solution. An organization with a single customer service rep who is also the office manager, and is managed by the CEO, yes, has someone who addresses customer success issues. But the amount of time—and, by extension, budget—that is spent on those issues will be far below that of an organization with dozens of customer service people. Engaging with this smaller account would therefore be far less likely to be worth your time. Generally, having a crisp sense of the specific titles you're selling to will help lead to the right accounts, because accounts that don't have those titles in-house won't be qualified. We'll get into that more when we talk about prospecting.

### What are the costs associated with this problem?

Understanding the costs associated with the problem you're addressing will help you frame an argument for why would-be customers should expend budget on your solution. Depending on your space, you might be looking at what it costs to solve a given problem—or what it will cost not to solve it. Either way, you'll want to calculate the return on investment (the mythical "ROI") associated with your solution.
Often, these are very clear costs. For instance, in datacenter solutions, like data storage, there's the issue of ever-expanding storage. That is, for every number of employees that are added to an organization, there will be a need to add more disk storage to support them—and this has a very distinct cost. So if your solution is focused on, say, storage de-duplication and virtualization, then you'll need to understand the cost of expanded storage.
Or for support software, you'd need to understand the cost of support personnel—each of whom can only handle so many tickets per workday—for a growing customer base.
Or for sales automation and CRM solutions, you'd need to understand the cost of adding more salespeople to get more revenue. Because reps can only handle a limited number of deals without software assistance, CRMs can reduce the number of reps a company needs per dollar of revenue, or, on the flip side, create more revenue per rep.
In cases like this—where the implementation of a given solution clearly and directly minimizes certain costs—you're dealing with what's known as "hard ROI."
Other times, the costs a solution addresses may be opportunity costs. For instance, consider the customer support example above. The flip side to the cost of additional support personnel is the opportunity cost of customers who stop being customers due to insufficient support. So while one problem companies need to consider is the cost of adding more personnel as they add new customers, they also need to consider whether these new customers may end up becoming former customers if they aren't sufficiently enabled or supported. The cost here would be the opportunity cost of those customers not renewing their licenses or purchasing more seats of the product being supported.
Or in the case of sales automation and efficiency software, an opportunity cost would be incremental deals missed in a given time frame due to insufficient rep efficiency. For instance, your solution might allow reps to do more in a given amount of time—if instead of closing eight deals of average deal value $8,000 every month, they can instead close ten deals, that's a 25% bump and $16,000 in incremental revenue per rep per month. In this case, you're identifying the opportunity cost of not employing your solution. These benefits can sometimes be harder to prove, in that other actions must occur in order to realize the promised benefit. As such, they are sometimes referred to as "soft ROI."
Lastly, there may be more directional costs and opportunity costs and benefits. These are often harder to quantify. For instance, information technology vendors often sell the value of "increased agility"—that is, that users will be able to more quickly execute projects for their internal customers and thus allow the businesses they support to capture opportunities better. That's great, but that's a pretty big domino rally of cause and effect and hypothesized impact to take to the bank, and another example of "soft ROI."
Once you have a sense of what these specific costs or opportunity costs are, it's an easy trick to simply scale them up or down based on the size of the potential customers you are looking to engage with. As you do, you'll better understand the potential opportunity of sale for your organization, and the value of your solution for the prospect organization (which goes to qualification and, later, prospecting).
But at the very minimum, you need to understand the unit costs of the problems you're addressing, so you can position the value of solving them with your solution.

### How do people currently solve this problem? Why do current solutions fail?

Knowing the current solution paths for your problem will be important, in that the thrust of your sales conversations will be to persuade your would-be customers that the means by which they currently solve the problem—or their continued non-solution of the problem—is insufficient for their business, and that they should be implementing your solution instead. You'll have a hard time driving that argument, or even identifying the current state of the world within a target organization, if you're not clear on the typical solution paths and their shortfalls.

**No Solution**
In high-technology, innovative solution sales, where your solution is brand-new, one of the most common answers to this question will be "we don't solve this problem." Your challenge, then, is to persuade prospective customers that it's worth solving—in that the current non-solution is costly, whether that means actual hard cost or softer opportunity cost. Hence the importance of understanding and being able to model the costs of non-solution.

**Solution via Process**
Organizations that already solve the problem via process are one step further along. For instance, in the case of TalentBin's customers, the problem that technical recruiters have is being able to discover and engage with software-engineering candidates that they can't find on traditional hiring services like LinkedIn or Monster. Some of the more advanced technical recruiters have implemented processes to use generic search engines like Google to manually browse and discover these engineering candidates on places like Twitter, GitHub, and Stack Overflow. They then use, again, standard email tooling to reach out to and follow up with those candidates. While there are tools being used in this situation, they're in service of a process that has been implemented to solve the root issue.
So, too, for sales organizations that don't have a robust CRM solution and associated reporting in place. In lieu of that reporting, the sales organization might use a process of status meetings or habitual CC'ing of sales management on ongoing deal conversations.
In these cases, you need to address the question of why that existing process is an inferior solution path. Often it comes down to the time cost associated with it and, beyond that, with the general frailty of process.
In the TalentBin case above, for example, the use of normal search engines in a manual process of candidate discovery is very time-consuming; while the outcomes could be valuable (a quality candidate hired), the time cost to get there may be substantial. Or a pertinent candidate may be missed, delaying the speed of hiring. In the example of the sales organization, the time cost of the reporting process keeps reps from spending their time on selling. Moreover, what's reported is self-reported, without an audit path—potentially allowing reps to provide information that makes them look good but actually diverges from the reality of their sales pipelines.

**Solution via service providers**
A step beyond organizations that have implemented processes to resolve their business pains would be those doing so with service providers. For instance, rather than subscribing to a media database like Cision to help their PR team keep tabs on relevant journalists, an organization might just have a PR firm on retainer. Or instead of solving their engineering-hiring problems with process or products, an organization might just work with a recruiting agency.
Solving a business pain with a professional service could be a totally viable solution for the organization in question, but it will have downsides. Cost will typically be one of those downsides, in that service providers need to make a margin for their businesses to be successful. For instance, in technical recruiting, a recruiting agency will typically make a fee of 25% of the first-year salary for an engineer that they place. If an engineer is making $150,000, that's a $37,500 fee—not a small amount. If an organization has recruiters in place, then a solution that provides them candidate access and engagement tools, like TalentBin, could help them hire the same quality of engineer, but at a dramatically reduced cost—the cost of the solution in question, plus the salary expense of the in-house recruiter.

**Solution via product**
Lastly, we have the most advanced organizations, those that already are using products to solve the problem in question. These products won't necessarily be pure "competition"—they might simply be in the same general space as yours—but this introduces a larger concept that includes competition. That is, these organizations are using solutions that are competing for the budget and user time you want. But that's often a good sign when you're qualifying an account (more on this later), since the organization has sufficient conviction in the importance of the problem that they expend budget on tooling to solve it.
For instance, while TalentBin is a talent search engine with advanced recruiting CRM features, with pure competitors in the market, there are a variety of other solutions that organizations use to solve the business problem of engineering recruiting: job postings on a traditional job board, subscriptions to a traditional resume database, or the business solutions of professional networks like LinkedIn.
This is where things can get complicated, in that the more mature a space, the more variety or alternative solutions there may be—including those that are perhaps not pure market substitutes, but instead are complementary/co-operative solutions. I'm a fan of sales professionals being "students of the game." The more you know about these other solutions and their relative plusses and minuses, the better. But there will invariably be diminishing returns in knowing everything about every potential solution under the sun; having intimacy with at least the most common ones should suffice, so you're rarely surprised in a conversation.
Importantly, this isn't just about knowing who the players are, and their deficits. The only way you'll be able to build an authoritative narrative is if it is credible, and that means recognizing the strengths in existing solutions too—even if that's as simple as their low cost. For instance, while recruiting agencies may be costly, they're extremely useful if you need candidate flow immediately, or don't have in-house recruiter labor. Or while job postings may not be very helpful for hiring in verticals where candidate demand and supply is out of whack, that doesn't mean that job postings are fundamentally problematic; they are very helpful for hiring proactive, motivated job seekers, like sales or customer success staff.
Having a deep understanding of the myriad ways organizations resolve the problem you're addressing will position you well, so you can frame your solution's narrative in the larger context of the market.

### What has changed that enables a new solution?

Typically in product innovation, and the associated selling of those products, something has "changed" that enables a new solution. It's important for you to understand the underpinnings of the change, because your narrative will need to explain it. In fact, that change will be crucial to how you frame the new opportunities that have opened up for your would-be customers.
For instance, in sales CRM, the rise of ubiquitous web access and browser technology provided an opportunity for Salesforce to create a SaaS offering that was far less clunky than traditional on-premise CRMs, accessible from any web-enabled client, and always up-to-date with the latest features.
Or in the recruiting world, the creation of LinkedIn as a "professional network," which was adopted by a segment of the populace, enabled recruiters to tap into a much broader set of potential employees than traditional job board resume databases offered.
Or the falling price of flash memory made it cost-effective to create datacenter storage appliances made purely of flash memory, with companies like Pure Storage helping organizations take advantage of this development.
Knowing what has changed will not only allow you to pose a credible narrative, but will also point to the trends you can expect in the market. Pay close attention to those trends and what they mean for your sales narrative—whether they support it or undermine it.
For instance, TalentBin takes advantage of the rise of "implicit professional activity" available on the web—for example, question-and-answer activity on places like Stack Overflow, professionally relevant tweets, and so on. This has been enabled by the creation of online communities and the growing availability of digitized "professional output" like patent databases, publications, and so forth. But to the extent that this trend is only increasing—as more and more software engineers make GitHub, Stack Overflow, Twitter, and so on part of their day-to-day professional world, for instance—then the "thing that has changed" will only continue to increase in momentum, further supporting TalentBin's approach and underscoring its sales narrative.
In other cases, these changes don't enable a new solution—they demand one. With the rise of the iPhone and other smartphones, for example, consumers now spend much more of their "online time" on their small mobile devices, rather than on desktop or laptop computers. As a result, time spent online shopping is following suit, putting pressure on existing e-commerce brands to produce mobile-first offerings. Those vendors are now responsive to companies promising solutions to this new problem, like mobile-app development firms, software vendors that make existing e-commerce websites mobile-friendly, and so on. Again, a change precipitated the need, and thus the attractiveness of the solution.

### How does the new solution work?

Of course, if something has changed that enables a new means of attacking an existing problem, or creates a new problem to be solved, you're going to need to explain how your solution goes about addressing that change.
Conveniently, for most founders this should be pretty easy; they will generally have strong market and product intimacy. The more important thing, though, may be to have a good sense of how to easily and clearly explain your approach to prospects. Often a good way to do that is to compare your product to existing solutions that your prospect understands.
For Salesforce, this would be something like "It's like your traditional CRMs, but it takes advantage of the browser and the web to let you access your CRM whenever you want, wherever you are. And it's way less clunky, and always has the most up-to-date features."
Or for Groupon, it might be "We have acquired email lists of tens of thousands of would-be customers in a given geography, who we'll help you access by offering compelling coupon-like deals, once a day, that get them in your door."
The level of detail that you'll have to delve into will vary depending on the audience. But at a minimum, you'll have to be able to explain the nuts and bolts of how your new solution takes advantage of change to help resolve a problem.

### Qualitative/Quantitative Proof of a Better Solution

As you can see, each part of the narrative builds on the part before. This will be true for every piece of marketing collateral you produce—messaging, email and web copy, slide decks, and so on. And once you've covered "this is what has changed" and "this is how we take advantage of that change," you'll naturally want to get to "and here's why we know our solution is better."
Because you are now intimate with the problem space, the costs associated with the problem, and the means by which the problem is typically solved, quantitative comparisons should be easy. You already know the general metrics by which existing solutions are measured. Take another look at how you answered "What are the costs associated with the problem?" Now it's time to present why your solution does a better job, as measured in the same language as existing solutions. Typically, it'll be as simple as "Our offering does more X" or "Our offering requires less Y." What that X and Y are will depend on the space, but that will typically be the formula.
So for the recruiting space, where TalentBin plays, key metrics are cost per hire, time to fill an open role, and quality of hire. Of course, each of those metrics involves a lot of moving parts. So while you'll want to be able to address the big picture, you'll have to address the constituent pieces too.
For instance, a recruiter or recruiting manager will typically look at candidate databases to determine how many of their target candidates they can find and then recruit, and whether the contact information for those candidates is readily available. In the case of a solution like TalentBin, the metrics that would be interesting to a recruiter are things like search-result counts for a given skill profile in a given geography. So when presenting to recruiters, we would make sure to present our search results for candidates with, say, Ruby, JavaScript, and MySQL experience in the region they were recruiting out of; then we'd compare those search results to what came up on LinkedIn Recruiter or a job board's resume database. When the recruiter saw that we offered three, four, or ten times the number of results, it was pretty clear why our offering was superior.
You'll need to do this for each part of your offering's value proposition. For instance, search discovery is only part of the workflow that a recruiter engages in. Outreach is another. When assessing how a product can help with candidate outreach, recruiters might be interested, for example, in email-address availability and the speed with which they can execute their outreach. If you were selling to recruiters, then, you might start by noting the one hundred InMails per month that a recruiter gets through LinkedIn Recruiter, and the amount of time it would take to send those InMails without templating or mass-outreach functionality. Then you would present the volume of email outreach that could be achieved in the same amount of time using your solution.
This is also where you can do a good job of guiding the conversation, based on your deep understanding of the problem, market, and existing solutions. For instance, your competitors may try to cite metrics that don't matter. In the world of talent acquisition, that's often large numbers of resumes in a database. "We have two hundred million profiles!" That might be interesting, but what does it matter for a recruiter focused on physician assistants or iOS developers if there are only twelve possible candidates in those two hundred million profiles?
You can also spotlight qualitative differences between your solution and the competition, but this should be in supplement, where possible, to metric-based comparison. And ideally you should have metrical backing to support those qualitative differences. For instance, if you were presenting a mobile CRM offering that promised better usability than desktop CRMs (a qualitative claim), ideally you would have metrics to support those claims. Logins per day or data-quality metrics, for example, could help prove that as a result of this enhanced usability, actions that can be counted—and compared—are happening more or less often than with existing solutions.
Third-party validation is another means by which to present your offering's superiority and lend credibility to your claims. This would be things like customer counts, customer testimonials (which ideally feature the metrics and qualitative claims you've defined above), deeper case studies, press and analyst coverage (which we'll get into more later and ideally features large parts of your narrative, restated by the author), and so on. This isn't a core part of the narrative, per se, but rather a means by which to say "and this is who agrees."
There are all manner of ways to respond to "Okay, so how do you know your product's better?" Whichever you choose, though, having them at the ready is a requirement for your narrative.

## OUTPUT REQUIREMENTS

Generate:
1. **SALES NARRATIVE** - MUST contain exactly 8 sections, each starting with a bold header:
   - "**What's the problem?**" (then 1-3 paragraphs)
   - "**Who has the problem?**" (then 1-3 paragraphs)
   - "**What's the cost of not solving the problem?**" (then 1-3 paragraphs)
   - "**How is this currently solved? Why doesn't that work?**" (then 1-3 paragraphs)
   - "**What has changed?**" (then 1-3 paragraphs)
   - "**How does it work?**" (then 1-3 paragraphs)
   - "**How do you know it's better?**" (then 1-3 paragraphs)
   - "**Pricing**" (then 1-3 paragraphs)

   FAILURE TO INCLUDE THESE EXACT BOLD HEADERS MAKES THE OUTPUT INVALID. Look at the TalentBin and Salesforce examples above - every section begins with its bold header. Your output MUST follow this same pattern.

2. **100-WORD DESCRIPTION** - A product marketing summary suitable for a website or pitch deck. Covers problem, solution, and key differentiator. No headers needed.

3. **50-WORD DESCRIPTION** - An elevator pitch that can be spoken in ~20 seconds. Problem + solution + why it's better. No headers needed.

4. **25-WORD DESCRIPTION** - A tagline or one-liner that captures the essence. No headers needed.

## QUESTIONNAIRE ANSWERS:

${answersSummary}

---

IMPORTANT: Respond ONLY with valid JSON in this exact format (no markdown code blocks, just raw JSON):
{"narrative": "The full sales narrative with question headers...", "description100w": "The 100-word description...", "description50w": "The 50-word description...", "description25w": "The 25-word tagline..."}`;

    // Chatbase has an 8000 character limit per message
    // If the prompt is too long, we need to chunk it
    const CHATBASE_LIMIT = 7500;

    let chatbaseHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let finalMessage = systemPrompt;

    if (systemPrompt.length > CHATBASE_LIMIT) {
      // Split into chunks
      const chunks: string[] = [];
      const sections = answersSummary.split(/(?=## )/);

      let currentChunk = "";
      for (const section of sections) {
        if (currentChunk.length + section.length > CHATBASE_LIMIT - 1000) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
          }
          currentChunk = section;
        } else {
          currentChunk += section;
        }
      }
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }

      // Add chunks as conversation history
      for (let i = 0; i < chunks.length; i++) {
        chatbaseHistory.push({
          role: "user",
          content: `[Sales Narrative Questionnaire Part ${i + 1} of ${chunks.length}]\n\n${chunks[i]}`,
        });
        if (i < chunks.length - 1) {
          chatbaseHistory.push({
            role: "assistant",
            content: `I've received part ${i + 1}. Please continue with the remaining sections.`,
          });
        }
      }

      // Final message includes generation instructions WITH header requirements
      finalMessage = `Based on all the questionnaire answers I've shared, please generate:

1. A SALES NARRATIVE following the Founding Sales format by Pete Kazanjy. This MUST contain exactly 8 sections, each starting with a bold header on its own line. The headers are MANDATORY - without them the output is invalid:

**What's the problem?**
(1-3 paragraphs of flowing prose)

**Who has the problem?**
(1-3 paragraphs of flowing prose)

**What's the cost of not solving the problem?**
(1-3 paragraphs of flowing prose)

**How is this currently solved? Why doesn't that work?**
(1-3 paragraphs of flowing prose)

**What has changed?**
(1-3 paragraphs of flowing prose)

**How does it work?**
(1-3 paragraphs of flowing prose)

**How do you know it's better?**
(1-3 paragraphs of flowing prose)

**Pricing**
(1-3 paragraphs of flowing prose)

2. A 100-WORD DESCRIPTION - Product marketing summary

3. A 50-WORD DESCRIPTION - Elevator pitch

4. A 25-WORD DESCRIPTION - Tagline

IMPORTANT: Respond ONLY with valid JSON (no markdown):
{"narrative": "...", "description100w": "...", "description50w": "...", "description25w": "..."}`;
    }

    console.log(`Sending to Chatbase: ${chatbaseHistory.length} history messages, final message: ${finalMessage.length} chars`);

    // Call Chatbase
    let aiResponse = "";
    try {
      const chatbaseResult = await sendToChatbase(finalMessage, undefined, chatbaseHistory);
      aiResponse = chatbaseResult.response;
    } catch (chatbaseError) {
      console.error("Chatbase API error:", chatbaseError);
      return NextResponse.json(
        { error: "Failed to generate narrative. Please try again." },
        { status: 500 }
      );
    }

    // Parse the JSON response
    let parsedResponse: {
      narrative: string;
      description100w: string;
      description50w: string;
      description25w: string;
    };

    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }
      parsedResponse = JSON.parse(jsonMatch[0]);

      // Validate required fields
      if (!parsedResponse.narrative || !parsedResponse.description100w ||
          !parsedResponse.description50w || !parsedResponse.description25w) {
        throw new Error("Missing required fields in response");
      }
    } catch (parseError) {
      console.error("Failed to parse Chatbase response:", parseError);
      console.error("Raw response:", aiResponse);
      return NextResponse.json(
        { error: "Failed to parse generated content. Please try again." },
        { status: 500 }
      );
    }

    // Create the version record
    const version = await prisma.salesNarrativeVersion.create({
      data: {
        userId: user.id,
        narrative: parsedResponse.narrative,
        description100w: parsedResponse.description100w,
        description50w: parsedResponse.description50w,
        description25w: parsedResponse.description25w,
      },
    });

    // Create snapshot of all answers linked to this version
    const answerSnapshots = questions.map((q) => ({
      userId: user.id,
      questionId: q.id,
      versionId: version.id,
      answer: answerMap.get(q.id) || "",
    }));

    await prisma.salesNarrativeAnswer.createMany({
      data: answerSnapshots,
    });

    // Update merge variables with the latest narrative outputs
    const mergeVariables = [
      { mergeField: "SALES_NARRATIVE", name: "Sales Narrative", value: parsedResponse.narrative },
      { mergeField: "VALUE_PROP_100W", name: "Value Proposition (100 words)", value: parsedResponse.description100w },
      { mergeField: "VALUE_PROP_50W", name: "Value Proposition (50 words)", value: parsedResponse.description50w },
      { mergeField: "VALUE_PROP_25W", name: "Value Proposition (25 words)", value: parsedResponse.description25w },
    ];

    for (const mv of mergeVariables) {
      await prisma.gtmVariable.upsert({
        where: {
          userId_mergeField: {
            userId: user.id,
            mergeField: mv.mergeField,
          },
        },
        update: {
          value: mv.value,
        },
        create: {
          userId: user.id,
          mergeField: mv.mergeField,
          name: mv.name,
          value: mv.value,
          isDefault: false,
        },
      });
    }

    return NextResponse.json({
      success: true,
      version: {
        id: version.id,
        narrative: version.narrative,
        description100w: version.description100w,
        description50w: version.description50w,
        description25w: version.description25w,
        createdAt: version.createdAt,
      },
      summary: {
        totalQuestions: questions.length,
        answeredCount,
      },
    });
  } catch (error) {
    console.error("Error generating sales narrative:", error);
    return NextResponse.json(
      { error: "Failed to generate narrative" },
      { status: 500 }
    );
  }
}
