"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

interface Channel {
  id: string;
  name: string;
  is_member: boolean;
}

export default function SetupContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspace = searchParams.get("workspace");
  const teamId = searchParams.get("team_id");

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teamId) return;

    fetch(`/api/slack/channels?team_id=${teamId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.channels) {
          setChannels(data.channels);
          // Default to #general if it exists
          const general = data.channels.find(
            (ch: Channel) => ch.name === "general"
          );
          if (general) {
            setSelectedChannel(general.id);
          }
        } else {
          setError(data.error || "Failed to load channels");
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load channels");
        setLoading(false);
      });
  }, [teamId]);

  const handleSendWelcome = async () => {
    if (!selectedChannel) return;

    setSending(true);
    try {
      const res = await fetch("/api/slack/welcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          team_id: teamId,
          channel_id: selectedChannel,
        }),
      });

      if (res.ok) {
        router.push(`/?installed=true&workspace=${encodeURIComponent(workspace || "")}`);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to send welcome message");
        setSending(false);
      }
    } catch {
      setError("Failed to send welcome message");
      setSending(false);
    }
  };

  const handleSkip = () => {
    router.push(`/?installed=true&workspace=${encodeURIComponent(workspace || "")}`);
  };

  if (!teamId) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <p className="text-red-600">Missing workspace information</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🌊</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Almost there!
          </h1>
          <p className="text-gray-600">
            Mikey has been added to <strong>{workspace}</strong>
          </p>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Add Mikey to your &quot;sales&quot; or &quot;GTM&quot; channel!
          </label>
          <p className="text-sm text-gray-500 mb-3">
            Choose the channel where most of your GTM topics are discussed - you can add him to more later.
          </p>

          {loading ? (
            <div className="animate-pulse bg-gray-200 h-12 rounded-lg"></div>
          ) : error ? (
            <div className="text-red-600 text-sm">{error}</div>
          ) : (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Search channels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
              />
              <div className="border border-gray-300 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {channels
                  .filter((ch) =>
                    ch.name.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((channel) => (
                    <div
                      key={channel.id}
                      onClick={() => setSelectedChannel(channel.id)}
                      className={`px-4 py-2 cursor-pointer hover:bg-blue-50 ${
                        selectedChannel === channel.id
                          ? "bg-blue-100 text-blue-900 font-medium"
                          : "text-gray-900"
                      }`}
                    >
                      #{channel.name}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <button
            onClick={handleSendWelcome}
            disabled={!selectedChannel || sending || loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
          >
            {sending ? "Adding..." : "Add To Channel"}
          </button>

          <button
            onClick={handleSkip}
            className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 px-6 rounded-lg transition-colors"
          >
            Skip for now
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-6">
          You can always add Mikey to channels later with{" "}
          <code className="bg-gray-100 px-1 py-0.5 rounded">/invite @Mikey</code>
        </p>
      </div>
    </main>
  );
}
