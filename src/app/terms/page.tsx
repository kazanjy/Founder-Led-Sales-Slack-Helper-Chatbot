import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — Mikey",
  description: "The terms that govern your use of Mikey.",
};

// Date is rendered statically so the page doesn't shift on each
// deploy. Update by hand when the terms substantively change.
const LAST_UPDATED = "May 20, 2026";
const CONTACT_EMAIL = "legal@mikeybot.io";
const GOVERNING_STATE = "California, USA";

export default function TermsOfServicePage() {
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
          Terms of Service
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Last updated: {LAST_UPDATED}
        </p>

        <div className="prose prose-gray dark:prose-invert max-w-none mt-8 prose-headings:text-gray-900 dark:prose-headings:text-gray-100 prose-p:text-gray-700 dark:prose-p:text-gray-200 prose-li:text-gray-700 dark:prose-li:text-gray-200 prose-strong:text-gray-900 dark:prose-strong:text-gray-100 prose-a:text-purple-600 dark:prose-a:text-purple-300">
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your
            access to and use of Mikey (&ldquo;Mikey,&rdquo;
            &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;),
            including the website at{" "}
            <a href="https://mikeybot.io">mikeybot.io</a> and our Slack
            and web applications (the &ldquo;Service&rdquo;).
          </p>
          <p>
            By signing in, connecting an integration, or otherwise
            using the Service, you agree to these Terms. If you do not
            agree, do not use the Service.
          </p>

          <h2>1. Eligibility and accounts</h2>
          <ul>
            <li>You must be at least 16 years old and able to form a binding contract.</li>
            <li>You are responsible for the security of your account credentials and for all activity that occurs under your account.</li>
            <li>If you use the Service on behalf of an organization, you represent that you have authority to bind that organization, and &ldquo;you&rdquo; refers to that organization.</li>
            <li>You agree to provide accurate account information and to keep it current.</li>
          </ul>

          <h2>2. The Service</h2>
          <p>
            Mikey provides AI-assisted tools for founder-led sales:
            playbook generation, pre-call research, call recap and
            coaching, deal management, and related features. We may
            add, change, or remove features at any time. We aim to
            keep the Service available but do not guarantee
            uninterrupted access.
          </p>

          <h2>3. Your content</h2>
          <p>
            You retain all rights to the content you submit to the
            Service (&ldquo;Your Content&rdquo;), including sales
            narratives, ICPs, decks, sequences, notes, transcripts,
            and uploaded files. You grant Mikey a worldwide,
            non-exclusive, royalty-free license to host, store,
            transmit, process, and display Your Content solely to
            operate, secure, and improve the Service for you.
          </p>
          <p>
            You represent that you have the rights necessary to submit
            Your Content and that doing so does not violate any law,
            contract, or third-party right.
          </p>

          <h2>4. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service to violate any law or third-party right, including intellectual-property, privacy, and anti-spam laws.</li>
            <li>Send unsolicited bulk messages, spam, or harassing content through any Mikey-powered channel.</li>
            <li>Reverse engineer, decompile, or attempt to extract the source code of the Service, except to the extent applicable law expressly permits.</li>
            <li>Probe, scan, or test the vulnerability of any Mikey system, or bypass any security or rate limit.</li>
            <li>Use the Service to build a competing product, or to train a machine-learning model that competes with Mikey.</li>
            <li>Submit content that is unlawful, defamatory, infringing, or that contains personal data you are not authorized to share.</li>
            <li>Misrepresent your identity or affiliation with any person or organization.</li>
          </ul>

          <h2>5. AI output — no warranty of accuracy</h2>
          <p>
            The Service uses large language models and third-party
            data providers to generate content. Output may be
            inaccurate, incomplete, biased, or out-of-date.{" "}
            <strong>
              You are responsible for reviewing all AI-generated output
              before relying on it, sending it externally, or using it
              to make business decisions.
            </strong>{" "}
            Do not submit information through the Service that you
            would not be comfortable sharing with our subprocessors
            (e.g. OpenAI). Treat anything the Service tells you about
            real companies or people as a draft that needs your
            verification.
          </p>

          <h2>6. Third-party integrations</h2>
          <p>
            Mikey integrates with third parties including Google,
            Slack, OpenAI, Chatbase, People Data Labs, Brave Search,
            Stripe, and various meeting-recorder vendors. Your use of
            those services is governed by their own terms and privacy
            policies. We are not responsible for third-party services
            and may disable an integration at any time.
          </p>

          <h2>7. Subscriptions, trials, and payment</h2>
          <ul>
            <li>Some features are available only with a paid subscription. Subscription fees, billing intervals, and trial lengths are presented in the Service before you subscribe.</li>
            <li>Subscriptions renew automatically at the end of each billing period unless you cancel before renewal.</li>
            <li>Fees are non-refundable except where required by law or as explicitly stated when you subscribe.</li>
            <li>We may change pricing with 30 days&rsquo; notice for renewal terms; existing terms apply through the end of the current period.</li>
            <li>Payment is processed by Stripe. By subscribing, you accept Stripe&rsquo;s terms.</li>
          </ul>

          <h2>8. Termination</h2>
          <p>
            You can stop using the Service at any time. We may
            suspend or terminate your access if you breach these Terms,
            misuse the Service, or to comply with law. On termination,
            your right to use the Service ends and we may delete
            account data subject to the retention rules in our{" "}
            <a href="/privacy">Privacy Policy</a>.
          </p>

          <h2>9. Disclaimers</h2>
          <p>
            <strong>
              The Service is provided &ldquo;as is&rdquo; and &ldquo;as
              available,&rdquo; without warranty of any kind, express
              or implied, including warranties of merchantability,
              fitness for a particular purpose, non-infringement, and
              quiet enjoyment.
            </strong>{" "}
            We do not warrant that the Service will be uninterrupted,
            secure, error-free, or that AI output will be accurate.
          </p>

          <h2>10. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, Mikey and its
            officers, employees, affiliates, and licensors will not be
            liable for any indirect, incidental, special, consequential,
            or punitive damages, or for lost profits, revenue, data,
            goodwill, or business interruption, arising out of or
            related to the Service, even if we have been advised of
            the possibility of such damages.
          </p>
          <p>
            Our total liability arising out of or related to the
            Service in any twelve-month period will not exceed the
            greater of (a) the amounts you paid us in the twelve
            months preceding the claim, or (b) USD $100.
          </p>

          <h2>11. Indemnification</h2>
          <p>
            You will defend, indemnify, and hold harmless Mikey from
            and against any claim, loss, or expense (including
            reasonable attorneys&rsquo; fees) arising from (a) Your
            Content, (b) your use of the Service in violation of these
            Terms, or (c) your violation of any law or third-party
            right.
          </p>

          <h2>12. Changes to the Terms</h2>
          <p>
            We may update these Terms from time to time. When we make
            material changes, we will update the &ldquo;Last
            updated&rdquo; date above and, where appropriate, notify
            you in-app or by email. Continued use of the Service after
            a change constitutes acceptance of the new Terms.
          </p>

          <h2>13. Governing law and disputes</h2>
          <p>
            These Terms are governed by the laws of the State of{" "}
            {GOVERNING_STATE}, without regard to its conflict-of-laws
            rules. Any dispute arising out of or related to these
            Terms or the Service will be brought exclusively in the
            state or federal courts located in San Francisco County,
            California, and you consent to personal jurisdiction
            there.
          </p>

          <h2>14. Miscellaneous</h2>
          <ul>
            <li>These Terms, together with our <a href="/privacy">Privacy Policy</a>, are the entire agreement between you and Mikey regarding the Service.</li>
            <li>If any provision is held unenforceable, the remaining provisions remain in effect.</li>
            <li>Our failure to enforce a provision is not a waiver of our right to do so later.</li>
            <li>You may not assign these Terms without our written consent; we may assign them to an affiliate or in connection with a merger, acquisition, or sale of assets.</li>
          </ul>

          <h2>15. Contact</h2>
          <p>
            Questions about these Terms? Email{" "}
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
