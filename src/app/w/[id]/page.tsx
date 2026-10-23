import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadSharedWorld } from "@/share/load";
import { Viewer } from "@/ui/Viewer";

/** Read-only share page: /w/<id>. */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shared = await loadSharedWorld((await params).id);
  if (!shared) return { title: "World not found · Speakworld" };
  const description = "A 3D world built by talking to it. Open it to look around.";
  // 1.9:1, up to 1200 px wide (the capture can't exceed the canvas size).
  const images = shared.thumbnailUrl ? [{ url: shared.thumbnailUrl }] : undefined;
  return {
    title: `${shared.title} · Speakworld`,
    description,
    openGraph: { title: shared.title, description, images, type: "website" },
    twitter: { card: images ? "summary_large_image" : "summary", title: shared.title, images },
  };
}

export default async function SharedWorldPage({ params }: Props) {
  const shared = await loadSharedWorld((await params).id);
  if (!shared) notFound();
  return <Viewer id={shared.id} world={shared.world} />;
}
