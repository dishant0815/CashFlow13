import { Dashboard } from "@/components/Dashboard";
import { MobileFallback } from "@/components/MobileFallback";
import { loadAllScenarios } from "@/lib/scenarios";

export default function Page() {
  const scenarios = loadAllScenarios();
  return (
    <>
      {/* < 768px: clean overlay only. */}
      <MobileFallback />
      {/* >= 768px: the real dashboard. */}
      <div className="hidden md:block">
        <Dashboard scenarios={scenarios} initialScenario="agency" />
      </div>
    </>
  );
}
