import { Suspense } from "react";
import UpgradeContent from "./UpgradeContent";

export default function UpgradePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-pulse text-gray-500 dark:text-gray-400">Loading...</div>
        </main>
      }
    >
      <UpgradeContent />
    </Suspense>
  );
}
