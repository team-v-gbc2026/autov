"use client";
import { useEffect, useRef, useState } from "react";
import ReferenceComposer from "@/components/studio/composer/reference-composer";
import ChatMessage from "@/components/studio/chat-message";
import styles from "@/components/studio/chat.module.css";

export default function ChatPreview() {
  const composer = useRef(null);
  const [active, setActive] = useState(false);
  const [text, setText] = useState("");
  const [prompt, setPrompt] = useState("");
  const finish = useRef<(() => void) | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  function stop() { if (timer.current) clearInterval(timer.current); setActive(false); finish.current?.(); finish.current = null; }
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); finish.current?.(); }, []);
  return <main className="studio" style={{ background: "#151a18" }}>
    <aside className={`glass chat-panel ${styles.panel}`} style={{ width: "min(420px, calc(100vw - 32px))", top: 24, bottom: 24, right: 16 }}>
      <div className="panel-heading"><div><h2>Assistant</h2><span className={styles.subtitle}>Development preview · simulated replies</span></div></div>
      <div className="chat-content"><div className="messages">
        <ChatMessage role="user" text="A warm burst of sparks, with a soft smoky trail. Can we make it feel cinematic?" files={["Amber reference.jpg"]} />
        <ChatMessage role="assistant" text={'Start with a **bright, compact burst**, then let the motion settle.\n\n- Warm amber sparks with a pale core\n- A short outward push, followed by slower drift\n- Soft smoke that lingers after the light fades\n\nTry a `2.4 second` duration. Keep the first half-second punchy.'} />
        {prompt && <ChatMessage role="user" text={prompt} />}
        {text && <ChatMessage role="assistant" text={text} streaming={active} />}
        {active && <div className={styles.notice} role="status"><span className={styles.dots}><i /><i /><i /></span>Responding</div>}
      </div></div>
      <ReferenceComposer ref={composer} references={[]} busy={false} saving={active} responding={active} onStop={async () => stop()} uploadFile={async () => { throw new Error("Uploads are unavailable in this preview."); }} onSend={async value => {
        setPrompt(value); setText(""); setActive(true);
        await new Promise<void>(resolve => {
          finish.current = resolve;
          const reply = "Let’s refine the timing. **A quick burst and a long fade** will make the effect feel more deliberate. Give the sparks a little variation in speed, then soften the trail as it drifts away.";
          let index = 0;
          timer.current = setInterval(() => { index += 2; setText(reply.slice(0, index)); if (index >= reply.length) stop(); }, 100);
        });
        return true;
      }} />
      <div className="chat-footnote">Discuss effects and reference images.</div>
    </aside>
  </main>;
}
