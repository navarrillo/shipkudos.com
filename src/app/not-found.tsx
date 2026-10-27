import Link from "next/link";
export default function NotFound() {
  return (
    <div className="prose">
      <div className="eyebrow">404 / NOT HERE YET</div>
      <h1>No signal found.</h1>
      <p>This profile has not been published, or the page does not exist.</p>
      <Link className="button button-primary" href="/leaderboard">
        Back to the board →
      </Link>
    </div>
  );
}
