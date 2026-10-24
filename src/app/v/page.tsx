import type { Metadata } from "next";
import { LinkViewer } from "@/ui/LinkViewer";

/** Read-only view of a world packed into the link: /v#world=... */

export const metadata: Metadata = {
  title: "A world built by voice · Speakworld",
  description: "A 3D world built by talking to it. Open it to look around.",
};

export default function LinkedWorldPage() {
  return <LinkViewer />;
}
