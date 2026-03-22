import { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";

interface PageProps {
  params: { slug: string };
}

async function getAnswer(slug: string) {
  const answer = await prisma.publicAnswer.findUnique({
    where: { slug, status: "published" },
  });

  if (answer) {
    // Increment view count (fire-and-forget)
    prisma.publicAnswer
      .update({
        where: { id: answer.id },
        data: { viewCount: { increment: 1 } },
      })
      .catch(() => {});
  }

  return answer;
}

async function getRelatedAnswers(currentId: string) {
  return prisma.publicAnswer.findMany({
    where: { status: "published", id: { not: currentId } },
    orderBy: { viewCount: "desc" },
    take: 5,
    select: { question: true, slug: true, preview: true },
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const answer = await prisma.publicAnswer.findUnique({
    where: { slug: params.slug, status: "published" },
    select: { question: true, preview: true, slug: true },
  });

  if (!answer) {
    return { title: "Answer Not Found — Ask Mikey" };
  }

  return {
    title: `${answer.question} — Ask Mikey`,
    description: answer.preview,
    openGraph: {
      title: answer.question,
      description: answer.preview,
      type: "article",
      url: `/answers/${answer.slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title: answer.question,
      description: answer.preview,
    },
  };
}

export default async function PublicAnswerPage({ params }: PageProps) {
  const answer = await getAnswer(params.slug);

  if (!answer) {
    notFound();
  }

  const relatedAnswers = await getRelatedAnswers(answer.id);

  // FAQ structured data for Google rich results
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: answer.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer.answer,
        },
      },
    ],
  };

  return (
    <div className="min-h-screen bg-white">
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <header className="border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/answers" className="text-lg font-bold text-gray-900">
            Ask Mikey
          </Link>
          <Link
            href="/ask"
            className="text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            Ask a Question
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Twitter embed for Twitter-sourced questions */}
        {answer.source === "twitter" && answer.twitterTweetUrl && (
          <div className="mb-6">
            <blockquote className="border-l-4 border-blue-400 pl-4 py-2 text-gray-600 italic">
              <p>{answer.question}</p>
              {answer.twitterHandle && (
                <cite className="text-sm text-gray-500 not-italic mt-1 block">
                  — @{answer.twitterHandle} on Twitter
                </cite>
              )}
            </blockquote>
          </div>
        )}

        {/* Question as H1 */}
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
          {answer.question}
        </h1>

        {/* Source attribution */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-8">
          <span>
            {answer.source === "twitter" && answer.twitterHandle
              ? `Asked on Twitter by @${answer.twitterHandle}`
              : "Asked on Ask Mikey"}
          </span>
          <span>·</span>
          <time dateTime={answer.createdAt.toISOString()}>
            {answer.createdAt.toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
        </div>

        {/* Full answer */}
        <article className="prose prose-gray max-w-none mb-12">
          {answer.answer.split("\n").map((paragraph, i) => {
            if (!paragraph.trim()) return null;
            if (paragraph.startsWith("## ")) {
              return (
                <h2 key={i} className="text-xl font-semibold mt-6 mb-3">
                  {paragraph.replace("## ", "")}
                </h2>
              );
            }
            if (paragraph.startsWith("### ")) {
              return (
                <h3 key={i} className="text-lg font-semibold mt-4 mb-2">
                  {paragraph.replace("### ", "")}
                </h3>
              );
            }
            if (paragraph.startsWith("- ") || paragraph.startsWith("* ")) {
              return (
                <li key={i} className="ml-4">
                  {paragraph.replace(/^[-*] /, "")}
                </li>
              );
            }
            return <p key={i}>{paragraph}</p>;
          })}
        </article>

        {/* Related questions */}
        {relatedAnswers.length > 0 && (
          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Related Questions
            </h2>
            <div className="space-y-3">
              {relatedAnswers.map((related) => (
                <Link
                  key={related.slug}
                  href={`/answers/${related.slug}`}
                  className="block p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                >
                  <h3 className="text-sm font-medium text-gray-900">
                    {related.question}
                  </h3>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                    {related.preview}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* CTA */}
        <div className="mt-12 text-center py-8 bg-gray-50 rounded-lg">
          <p className="text-gray-600 mb-3">Have a sales question?</p>
          <Link
            href="/ask"
            className="inline-flex items-center px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Ask Mikey
          </Link>
        </div>
      </main>
    </div>
  );
}
