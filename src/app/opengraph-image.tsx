import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Mikey — Your AI-Powered Founder-Led Sales Platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #7c3aed 0%, #3b82f6 50%, #6366f1 100%)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: "white",
          padding: "60px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "24px",
            marginBottom: "40px",
          }}
        >
          <div
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "20px",
              background: "rgba(255,255,255,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "48px",
            }}
          >
            👋
          </div>
          <div
            style={{
              fontSize: "64px",
              fontWeight: 800,
              letterSpacing: "-2px",
            }}
          >
            Mikey
          </div>
        </div>
        <div
          style={{
            fontSize: "32px",
            fontWeight: 600,
            textAlign: "center",
            lineHeight: 1.3,
            maxWidth: "900px",
            marginBottom: "24px",
          }}
        >
          Your AI-Powered Founder-Led Sales Platform
        </div>
        <div
          style={{
            fontSize: "20px",
            textAlign: "center",
            opacity: 0.85,
            maxWidth: "800px",
            lineHeight: 1.5,
          }}
        >
          Build your complete sales playbook automatically — narrative, ICP,
          discovery questions, call prep, outreach sequences, and more.
        </div>
        <div
          style={{
            position: "absolute",
            bottom: "30px",
            right: "40px",
            fontSize: "18px",
            opacity: 0.6,
          }}
        >
          mikeybot.io
        </div>
      </div>
    ),
    { ...size }
  );
}
