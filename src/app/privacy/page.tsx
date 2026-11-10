import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Mikey",
  description: "How Mikey collects, uses, stores, and protects your data.",
};

// Date is rendered statically so the page doesn't shift on each
// deploy. Update by hand when the policy substantively changes.
const LAST_UPDATED = "May 20, 2026";
const CONTACT_EMAIL = "privacy@mikeybot.io";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link
          href="/"
          className="text-sm text-purple-600 dark:text-purple-300 hover:underline"
        >
          ← Back to Mikey
        </Link>

        <h1 className="mt-6 text-3xl font-bold text-gray-900 dark:text-gray-100">
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="prose prose-gray dark:prose-invert max-w-none mt-8 prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-p:text-gray-700 dark:prose-p:text-gray-200 prose-li:text-gray-700 dark:prose-li:text-gray-200 prose-strong:text-gray-900 dark:prose-strong:text-gray-100 prose-a:text-purple-600 dark:prose-a:text-purple-300">
          <p>
            This Privacy Policy explains how Mikey (&ldquo;Mikey,&rdquo;
            &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;)
            collects, uses, stores, shares, and protects your personal
            information when you use our website at{" "}
            <a href="https://mikeybot.io">mikeybot.io</a> and the
            associated Slack and web applications (collectively, the
            &ldquo;Service&rdquo;).
          </p>
          <p>
            By using the Service you agree to the practices described
            here. If you do not agree, please do not use the Service.
          </p>

          <h2>1. Information we collect</h2>
          <p>We collect the following categories of information:</p>
          <h3>Account information</h3>
          <ul>
            <li>Name, email address, profile picture, and similar identifiers when you sign in with Google or Slack.</li>
            <li>A list of email addresses associated with your account (primary and any secondary identities you link).</li>
            <li>Slack workspace and team identifiers when you connect a Slack workspace.</li>
          </ul>
          <h3>Content you provide</h3>
          <ul>
            <li>Sales narratives, ideal customer profiles, discovery questions, decks, sequences, call recaps, coaching session notes, goals, tasks, comments, and other materials you create or upload.</li>
            <li>Files and documents you upload for processing.</li>
            <li>Messages, chats, and prompts you send through the Service.</li>
          </ul>
          <h3>Connected-service data</h3>
          <ul>
            <li>
              <strong>Google Calendar</strong>: when you grant calendar
              access, we read upcoming events from your primary calendar
              (title, time, location, description, meeting link,
              attendees) so we can pre-fill pre-call research and
              optionally schedule automated briefs. We do not modify
              your calendar or create events. We store a snapshot of
              the meeting context against each research brief you
              generate.
            </li>
            <li>
              <strong>Google profile</strong>: name, email, profile
              picture, and Google user id for sign-in.
            </li>
            <li>
              <strong>Slack</strong>: workspace id, channel list, user
              profile, and messages in channels where the Mikey bot is
              a member. When you authorize the user-token flow, we may
              post messages to Slack on your behalf.
            </li>
            <li>
              <strong>Meeting recorders</strong> (Fathom, Fireflies,
              Granola, etc.): when you connect one, we read your call
              list and transcripts so you can generate recaps and
              coaching reviews.
            </li>
          </ul>
          <h3>Usage information</h3>
          <ul>
            <li>Pages visited, features used, timestamps, IP address, browser, and device type.</li>
            <li>Session cookies used to keep you signed in.</li>
          </ul>

          <h2>2. How we use information</h2>
          <ul>
            <li>To provide and improve the Service (generating sales materials, briefs, coaching, search results, etc.).</li>
            <li>To authenticate you and secure your account.</li>
            <li>To call third-party AI and data-enrichment services on your behalf so we can produce the outputs you request.</li>
            <li>To deliver messages, briefs, and notifications you have configured (e.g. Slack broadcasts of pre-call research).</li>
            <li>To analyze usage so we can fix bugs, prioritize features, and monitor abuse.</li>
            <li>To comply with legal obligations.</li>
          </ul>

          <h2>3. Google API Services User Data Policy</h2>
          <p>
            Mikey&rsquo;s use and transfer to any other app of
            information received from Google APIs will adhere to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. Specifically:
          </p>
          <ul>
            <li>We use Google Calendar data only to provide and improve user-facing features that are visible to the requesting user (e.g. listing upcoming meetings, pre-filling prospect research, sending scheduled briefs to the user&rsquo;s chosen Slack destination).</li>
            <li>We do not transfer Google user data to others except as necessary to provide or improve user-facing features, comply with applicable law, or as part of a merger, acquisition, or sale of assets with notice to users.</li>
            <li>We do not use Google user data to serve advertisements.</li>
            <li>We do not allow humans to read Google user data unless we have your affirmative agreement for specific messages, doing so is necessary for security purposes (such as investigating abuse), to comply with applicable law, or our use is limited to internal operations and the data has been aggregated and anonymized.</li>
          </ul>

          <h2>4. Third-party processors</h2>
          <p>
            We rely on the following providers to deliver the Service.
            They process your data on our behalf under their own
            security and privacy commitments:
          </p>
          <ul>
            <li><strong>Vercel</strong> — hosting and edge delivery.</li>
            <li><strong>Postgres / Neon</strong> — database storage.</li>
            <li><strong>OpenAI</strong> and <strong>Chatbase</strong> — LLM inference for generated content and chat.</li>
            <li><strong>People Data Labs</strong> — person and company enrichment from email addresses you authorize us to look up (e.g. meeting attendees).</li>
            <li><strong>Brave Search</strong> and other web-search providers — sourcing publicly available web content for research briefs.</li>
            <li><strong>Slack</strong>, <strong>Google</strong>, and meeting-recorder vendors — when you connect those accounts.</li>
            <li><strong>Stripe</strong> — payment processing (only if you subscribe).</li>
          </ul>

          <h2>5. Sharing of information</h2>
          <p>We do not sell your personal information. We share data only:</p>
          <ul>
            <li>With the third-party processors listed above, strictly to operate the Service.</li>
            <li>With other members of your account or workspace, when you choose to share or collaborate (e.g. inviting teammates, posting briefs into a Slack channel).</li>
            <li>To comply with valid legal process, protect rights, or prevent abuse.</li>
            <li>In connection with a merger, acquisition, or sale of assets, with notice to you.</li>
          </ul>

          <h2>6. Data retention</h2>
          <p>
            We retain account data, content, and connected-service data
            for as long as your account is active. If you delete your
            account, we delete or anonymize associated personal data
            within 30 days, except where we are legally required to
            retain it. You can request earlier deletion by emailing{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>

          <h2>7. Your choices</h2>
          <ul>
            <li><strong>Access and correction</strong>: you can view and edit most of your information directly in the Service.</li>
            <li><strong>Disconnect integrations</strong>: you can revoke Google, Slack, and meeting-recorder access from the respective provider&rsquo;s settings, and you can re-authenticate to grant or remove scopes at any time.</li>
            <li><strong>Deletion</strong>: email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> to delete your account and associated data.</li>
            <li><strong>Cookies</strong>: you can clear or block cookies in your browser; doing so will require you to sign in again.</li>
          </ul>

          <h2>8. Security</h2>
          <p>
            We use industry-standard measures (HTTPS in transit,
            encrypted databases at rest, short-lived OAuth tokens with
            scope-limited access, audit logging on administrative
            actions) to protect your information. No system is perfectly
            secure; if you believe your account has been compromised,
            email us immediately.
          </p>

          <h2>9. Children</h2>
          <p>
            The Service is not directed to anyone under 16. We do not
            knowingly collect personal information from children.
          </p>

          <h2>10. International users</h2>
          <p>
            The Service is operated from the United States. If you use
            the Service from another country, you consent to the
            transfer of your information to the United States.
          </p>

          <h2>11. Changes to this policy</h2>
          <p>
            We may update this policy from time to time. When we make
            material changes, we will update the &ldquo;Last
            updated&rdquo; date above and, where appropriate, notify
            you in-app or by email.
          </p>

          <h2>12. Contact us</h2>
          <p>
            Questions, requests, or concerns? Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </div>

        <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-500 dark:text-gray-400 flex justify-between">
          <Link href="/" className="hover:text-purple-600 dark:hover:text-purple-300">
            ← Back to Mikey
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-purple-600 dark:hover:text-purple-300">
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
    </div>
  );
}
