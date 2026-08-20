"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation.js";

const REFRESH_INTERVAL_MS = 120_000;

export function ProjectManagementAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(centerProjectTimelineOnToday);
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    const interval = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  return null;
}

function centerProjectTimelineOnToday() {
  const timeline = document.querySelector<HTMLElement>(".project-timeline-wrap");
  const marker = timeline?.querySelector<HTMLElement>(".project-timeline-today-layer .project-timeline-today");
  const track = timeline?.querySelector<HTMLElement>(".project-timeline-track");
  const details = timeline?.querySelector<HTMLElement>(".project-timeline-details");
  const summary = timeline?.querySelector<HTMLElement>(".project-timeline-summary");

  if (!timeline || !marker || !track || !details || !summary) {
    return;
  }

  const timelineRect = timeline.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  const trackRect = track.getBoundingClientRect();
  const trackStart = timeline.scrollLeft + trackRect.left - timelineRect.left;
  const columnGap = Math.max(0, trackStart - details.getBoundingClientRect().width);
  const visibleStart = trackStart;
  const visibleEnd = Math.max(visibleStart, timeline.clientWidth - summary.getBoundingClientRect().width - columnGap);
  const markerPosition = timeline.scrollLeft + markerRect.left - timelineRect.left + markerRect.width / 2;
  const targetScroll = markerPosition - (visibleStart + (visibleEnd - visibleStart) / 2);

  timeline.scrollLeft = Math.max(0, Math.min(targetScroll, timeline.scrollWidth - timeline.clientWidth));
}
