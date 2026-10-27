"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
type Advertisement = {
  title: string;
  description: string;
  token: string;
  href: string;
  image: string | null;
};
export function Ad({
  placement = "primary",
}: {
  placement?: "primary" | "tool";
}) {
  const [ad, setAd] = useState<Advertisement | null>(null),
    ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/ads?placement=${placement}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(setAd)
      .catch(() => {});
    return () => controller.abort();
  }, [placement]);
  useEffect(() => {
    if (!ad || !ref.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined,
      sent = false;
    const observer = new IntersectionObserver(
      (entries) => {
        clearTimeout(timer);
        if (entries[0].intersectionRatio >= 0.5 && !sent)
          timer = setTimeout(() => {
            if (document.visibilityState !== "visible") return;
            sent = true;
            void fetch("/api/ad-events", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: ad.token }),
              keepalive: true,
            });
            observer.disconnect();
          }, 1000);
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(ref.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [ad]);
  if (!ad) return null;
  return (
    <a
      ref={ref}
      className="sponsor"
      href={ad.href}
      target="_blank"
      rel="sponsored noopener"
    >
      <span className="mono subtle text-xs">SPONSORED</span>
      {ad.image && (
        <Image
          unoptimized
          src={ad.image}
          alt=""
          width={48}
          height={48}
          className="rounded object-cover"
        />
      )}
      <div>
        <strong>{ad.title}</strong>
        <p>{ad.description}</p>
      </div>
      <ArrowUpRight size={20} />
    </a>
  );
}
