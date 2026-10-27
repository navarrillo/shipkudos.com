import { config } from "@/lib/config";
import { Dashboard } from "@/components/dashboard";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Your workspace",
  robots: { index: false, follow: false },
};
export default function DashboardPage() {
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">YOUR WORKSPACE</div>
        <h1>Build. Sync. Show up.</h1>
        <p>Your profile and your agents, in one place.</p>
      </div>
      <div className="max-w-3xl pb-12">
        <Dashboard
          configured={Boolean(
            config().GITHUB_CLIENT_ID && process.env.DATABASE_URL,
          )}
        />
      </div>
    </>
  );
}
