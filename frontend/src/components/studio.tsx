"use client";

import { useState } from "react";
import ParticleScene from "./particle-scene";
import StudioHeader from "./studio/studio-header";
import ReferencesPanel from "./studio/references-panel";
import ChatPanel from "./studio/chat-panel";
import PlaybackPanel from "./studio/playback-panel";
import PanelToggle from "./studio/panel-toggle";
import { usePlayback } from "./studio/use-playback";
import { useReferences } from "./studio/use-references";
import type {
  Project,
  Reference,
  Generation,
  EffectVersion,
} from "@/lib/project-types";

type StudioProps = {
  project: Project;
  userId: string;
  email: string;
  initialReferences: Reference[];
  initialGenerations: Generation[];
  versions: EffectVersion[];
};

export default function Studio({
  project,
  userId,
  email,
  initialReferences,
  initialGenerations,
  versions,
}: StudioProps) {
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  const [saving, setSaving] = useState(false);
  const playback = usePlayback();
  const references = useReferences(project.id, userId, initialReferences);

  return (
    <main
      className={`studio ${left ? "left-open" : ""} ${right ? "right-open" : ""}`}
    >
      <div className="viewport-grid" />
      <ParticleScene time={playback.time} />
      <StudioHeader
        project={project}
        email={email}
      />
      {!left && (
        <PanelToggle
          side="left"
          label="References"
          onOpen={() => setLeft(true)}
        />
      )}
      {!right && (
        <PanelToggle side="right" label="Chat" onOpen={() => setRight(true)} />
      )}
      <div hidden={!left}>
        <ReferencesPanel state={references} onCollapse={() => setLeft(false)} />
      </div>
      <div hidden={!right}>
        <ChatPanel
          projectId={project.id}
          initialGenerations={initialGenerations}
          versions={versions}
          referenceIds={references.references.map((ref) => ref.id)}
          busy={references.busy}
          saving={saving}
          setSaving={setSaving}
          onCollapse={() => setRight(false)}
        />
      </div>
      <PlaybackPanel playback={playback} />
    </main>
  );
}
