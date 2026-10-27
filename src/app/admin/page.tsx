import { Admin } from "@/components/admin";
export const metadata = {
  title: "Administration",
  robots: { index: false, follow: false },
};
export default function AdminPage() {
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">OPERATIONS</div>
        <h1>The control room.</h1>
        <p>Campaigns, participants and synchronization.</p>
      </div>
      <div className="pb-12">
        <Admin />
      </div>
    </>
  );
}
