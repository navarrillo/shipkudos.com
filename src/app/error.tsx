"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="prose">
      <h1>A temporary interruption.</h1>
      <p>Your saved data is safe. Please try loading this page again.</p>
      <button className="button button-primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
