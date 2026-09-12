"use client";

import { useMemo, useRef, useState } from "react";
import { useBoardLayout, referenceName } from "./studio/board/board-store";
import type { ComposerHandle } from "./studio/composer/reference-composer";
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

  const { layout } = useBoardLayout(project.id);
  const chat = useRef<ComposerHandle>(null);
  const displayReferences = useMemo(() => references.references.map(ref => ({ ...ref, name: layout[ref.id]?.name || referenceName(ref.name) })), [references.references, layout]);
  const boardState = { ...references, references: displayReferences };
  const mention = (reference: Reference) => { setRight(true); chat.current?.mention(reference); };

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
        <ReferencesPanel projectId={project.id} state={boardState} onMention={mention} locked={saving} onCollapse={() => setLeft(false)} />
      </div>
      <div hidden={!right}>
        <ChatPanel
          projectId={project.id}
          initialGenerations={initialGenerations}
          versions={versions}
          ref={chat}
          references={displayReferences}
          uploadFile={references.uploadFile}
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
