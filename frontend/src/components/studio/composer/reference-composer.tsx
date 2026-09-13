"use client";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { SuggestionProps } from "@tiptap/suggestion";
import type { Reference } from "@/lib/project-types";
import { ReferenceContext, ReferenceMention } from "./reference-mention";
import { PluginKey } from "@tiptap/pm/state";
import { EmitterContext, EmitterMention, type EmitterTag } from "./emitter-mention";
import { encodeEmitterMention, encodeMention } from "./prompt-format";
import ReferencePicker from "./reference-picker";
import Tooltip from "@/components/ui/tooltip";
import Icon from "../icon";
import styles from "./composer.module.css";

export type ComposerHandle = { mention: (reference: Reference) => void; setText: (text: string) => void; mentionEmitter: (emitter: EmitterTag) => void };
export default function ReferenceComposer({ ref, references, emitters = [], busy, saving, uploadFile, onSend, sendLabel = "Send message", responding = false, onStop }: {
  ref: Ref<ComposerHandle>; references: Reference[]; emitters?: EmitterTag[]; busy: boolean; saving: boolean;
  uploadFile: (file: File) => Promise<Reference>; onSend: (prompt: string, ids: string[]) => Promise<boolean>; sendLabel?: string; responding?: boolean; onStop?: () => Promise<void>;
}) {
  const [stopping, setStopping] = useState(false);
  if (!responding && stopping) setStopping(false);
  const latestEmitters = useRef(emitters);
  useEffect(() => { latestEmitters.current = emitters; }, [emitters]);
  const [emitterPicker, setEmitterPicker] = useState<SuggestionProps<EmitterTag> | null>(null);
  const emitterPickerRef = useRef<SuggestionProps<EmitterTag> | null>(null);
  const emitterActiveRef = useRef(0);
  const [emitterActive, setEmitterActive] = useState(0);
  const latest = useRef(references);
  useEffect(() => { latest.current = references; }, [references]);
  const [picker, setPicker] = useState<SuggestionProps<Reference> | null>(null);
  const pickerRef = useRef<SuggestionProps<Reference> | null>(null);
  const activeRef = useRef(0);
  const [active, setActive] = useState(0);
  const [hasText, setHasText] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const retryFiles = useRef(new Map<string, File>());
  const uploadLock = useRef(false);
  const sendLock = useRef(false);
  const editor = useEditor({
    immediatelyRender: false,
    // Tiptap stores these callbacks; refs are read only when suggestions run.
    // eslint-disable-next-line react-hooks/refs
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, bulletList: false, orderedList: false, horizontalRule: false, link: false }), ReferenceMention.configure({
      suggestion: {
        char: "@",
        items: ({ query }) => latest.current.filter(ref => ref.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8),
        command: ({ editor, range, props }) => editor.chain().focus().insertContentAt(range, [{ type: "mention", attrs: { id: props.id, label: latest.current.find(ref => ref.id === props.id)?.name || props.label } }, { type: "text", text: " " }]).run(),
        render: () => {
          const show = (props: SuggestionProps<Reference>) => { pickerRef.current = props; activeRef.current = 0; setActive(0); setPicker(props); };
          return {
            onStart: show, onUpdate: show,
            onExit: () => { pickerRef.current = null; setPicker(null); },
            onKeyDown: ({ event }) => {
              const current = pickerRef.current;
              if (event.key === "Escape") { pickerRef.current = null; setPicker(null); return true; }
              if (!current) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                activeRef.current = (activeRef.current + (event.key === "ArrowDown" ? 1 : -1) + current.items.length) % Math.max(1, current.items.length);
                setActive(activeRef.current); return true;
              }
              if (event.key === "Enter" && current.items[activeRef.current]) { current.command(current.items[activeRef.current]); return true; }
              return false;
            },
          };
        },
      },
    }),
    // Suggestion callbacks read current emitters only when the user types.
    // eslint-disable-next-line react-hooks/refs
    EmitterMention.configure({
      suggestion: {
        char: "#",
        pluginKey: new PluginKey("emitterMention"),
        items: ({ query }) => latestEmitters.current.filter(item => item.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8),
        command: ({ editor, range, props }) => editor.chain().focus().insertContentAt(range, [{ type: "emitterMention", attrs: { id: props.id, label: latestEmitters.current.find(item => item.id === props.id)?.name || props.label } }, { type: "text", text: " " }]).run(),
        render: () => {
          const show = (props: SuggestionProps<EmitterTag>) => { emitterPickerRef.current = props; emitterActiveRef.current = 0; setEmitterActive(0); setEmitterPicker(props); };
          return {
            onStart: show, onUpdate: show,
            onExit: () => { emitterPickerRef.current = null; setEmitterPicker(null); },
            onKeyDown: ({ event }) => {
              const current = emitterPickerRef.current;
              if (event.key === "Escape") { emitterPickerRef.current = null; setEmitterPicker(null); return true; }
              if (!current) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                emitterActiveRef.current = (emitterActiveRef.current + (event.key === "ArrowDown" ? 1 : -1) + current.items.length) % Math.max(1, current.items.length);
                setEmitterActive(emitterActiveRef.current); return true;
              }
              if (event.key === "Enter" && current.items[emitterActiveRef.current]) { current.command(current.items[emitterActiveRef.current]); return true; }
              return false;
            },
          };
        },
      },
    })],
    editorProps: { attributes: { role: "textbox", "aria-label": "Describe your effect. Type @ for a reference or # for an emitter.", "aria-multiline": "true", "data-placeholder": "Describe your effect... @ reference, # emitter" } },
    onUpdate: ({ editor }) => setHasText(!editor.isEmpty),
  });
  useEffect(() => { editor?.setEditable(!saving); }, [editor, saving]);
  function insert(reference: Reference) {
    editor?.chain().focus().insertContent([{ type: "mention", attrs: { id: reference.id, label: reference.name } }, { type: "text", text: " " }]).run();
  }
  useImperativeHandle(ref, () => ({ mention: insert, mentionEmitter: emitter => {
    editor?.chain().focus().insertContent([{ type: "emitterMention", attrs: { id: emitter.id, label: emitter.name } }, { type: "text", text: " " }]).run();
  }, setText: text => { editor?.chain().focus().insertContent(text).run(); } }));
  function replaceUpload(id: string, attributes: Record<string, string>) {
    if (!editor || editor.isDestroyed) return;
    const transaction = editor.state.tr;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "mention" && node.attrs.id === id) transaction.setNodeMarkup(position, undefined, { ...node.attrs, ...attributes });
    });
    editor.view.dispatch(transaction);
  }
  async function upload(id: string, file: File) {
    try {
      const reference = await uploadFile(file);
      replaceUpload(id, { id: reference.id, label: reference.name, status: "ready" });
      retryFiles.current.delete(id);
    } catch (cause) {
      replaceUpload(id, { status: "failed" });
      setError(cause instanceof Error ? cause.message : "Upload failed. Click the chip to retry.");
    }
  }
  async function filesSelected(files: FileList | null) {
    if (!editor || !files || uploadLock.current) return;
    uploadLock.current = true; setUploading(true); setError("");
    const queue = Array.from(files).map(file => ({ id: `upload-${crypto.randomUUID()}`, file }));
    // Placeholders are inserted synchronously at the saved editor selection.
    for (const { id, file } of queue) {
      retryFiles.current.set(id, file);
      editor.chain().insertContent([{ type: "mention", attrs: { id, label: file.name, status: "uploading" } }, { type: "text", text: " " }]).run();
    }
    try { for (const { id, file } of queue) await upload(id, file); }
    finally { uploadLock.current = false; setUploading(false); }
  }
  async function retry(id: string) {
    const file = retryFiles.current.get(id);
    if (!file || uploadLock.current || busy || saving) return;
    uploadLock.current = true; setUploading(true); setError(""); replaceUpload(id, { status: "uploading" });
    try { await upload(id, file); } finally { uploadLock.current = false; setUploading(false); }
  }
  async function send() {
    if (!editor || editor.isEmpty || saving || busy || uploading || sendLock.current) return;
    const ids = new Set<string>(); let invalid = false; let invalidEmitter = false;
    editor.state.doc.descendants(node => {
      if (node.type.name === "emitterMention" && !emitters.some(item => item.id === node.attrs.id)) invalidEmitter = true;
      if (node.type.name !== "mention") return;
      if (node.attrs.status !== "ready" || !references.some(ref => ref.id === node.attrs.id)) invalid = true;
      else ids.add(node.attrs.id);
    });
    if (invalidEmitter) { setError("Remove unavailable emitter tags before sending."); return; }
    if (invalid) { setError("Retry or remove unavailable references before sending."); return; }
    if (ids.size > 8) { setError("Use up to 8 references per prompt."); return; }
    const text = editor.getText({ textSerializers: { emitterMention: ({ node }) => encodeEmitterMention(node.attrs.id, emitters.find(item => item.id === node.attrs.id)?.name || node.attrs.label), mention: ({ node }) => encodeMention(node.attrs.id, references.find(ref => ref.id === node.attrs.id)?.name || node.attrs.label) } });
    if (text.length > 10000) { setError("Keep the prompt under 10,000 characters."); return; }
    setError("");
    const draft = editor.getJSON();
    sendLock.current = true;
    editor.commands.clearContent();
    let confirmed = false;
    try {
      confirmed = await onSend(text, [...ids]);
    } catch {
      setError("Your message could not be sent. Your draft has been restored.");
    } finally {
      // Preserve rich mention chips, and never erase anything typed meanwhile.
      if (!confirmed && !editor.isDestroyed) {
        if (editor.isEmpty) editor.commands.setContent(draft);
        else editor.commands.insertContentAt(0, draft.content || []);
      }
      sendLock.current = false;
    }
  }
  return <EmitterContext.Provider value={emitters}><ReferenceContext.Provider value={{ references, retry: id => { void retry(id); } }}>
    <form className={`composer ${styles.composer}`} onSubmit={event => { event.preventDefault(); void send(); }}>
      {picker && <ReferencePicker items={picker.items} active={active} onSelect={reference => picker.command(reference)} />}
      {emitterPicker && <div className={styles.picker} aria-label="Choose an emitter">
        <span className={styles.pickerHeading}>Emitters</span>
        {emitterPicker.items.length ? emitterPicker.items.map((emitter, index) => <button type="button" key={emitter.id} className={index === emitterActive ? styles.active : ""} onMouseDown={event => event.preventDefault()} onClick={() => emitterPicker.command(emitter)}>
          <span className={styles.emitterDot} style={{ background: emitter.color }} /><span>{emitter.name}</span><small>#</small>
        </button>) : <p>No matching emitters.</p>}
      </div>}
      <div onKeyDownCapture={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !event.defaultPrevented && !pickerRef.current && !emitterPickerRef.current) {
          event.preventDefault();
          event.stopPropagation();
          if (!saving && !responding) void send();
        }
      }}><EditorContent editor={editor} className={styles.editor} /></div>
      <div className="composer-toolbar"><div className={styles.tools}>
        <Tooltip content="Upload reference images" side="top"><button type="button" className="icon-button" disabled={saving || busy || uploading} aria-label="Upload reference images" onMouseDown={event => event.preventDefault()} onClick={() => fileInput.current?.click()}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 12 7-7a3 3 0 0 1 4 4L9 19a5 5 0 0 1-7-7L12 2M6 14l9-9" /></svg></button></Tooltip>
        <Tooltip content="Choose from board" side="top"><button type="button" className="icon-button" aria-label="Choose from board" disabled={saving} onMouseDown={event => event.preventDefault()} onClick={() => editor?.chain().focus().insertContent(" @").run()}>@</button></Tooltip>
        {emitters.length > 0 && <Tooltip content="Tag an emitter" side="top"><button type="button" className="icon-button" aria-label="Tag an emitter" disabled={saving} onMouseDown={event => event.preventDefault()} onClick={() => editor?.chain().focus().insertContent(" #").run()}>#</button></Tooltip>}
        <span role="status">{uploading ? "Uploading..." : responding ? "" : saving ? "Connecting…" : ""}</span>
      </div><button type={responding ? "button" : "submit"} className={`send-button ${responding ? styles.stop : ""}`} disabled={responding ? stopping || !onStop : !hasText || saving || busy || uploading} aria-label={responding ? stopping ? "Stopping response" : "Stop response" : sendLabel} title={responding ? "Stop response" : "Send message (Enter)"} onClick={responding ? async () => {
        if (stopping || !onStop) return;
        setStopping(true);
        try { await onStop(); }
        catch { setStopping(false); setError("Could not stop the response. Try again or reconnect."); }
      } : undefined}>{responding ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" /></svg> : <Icon name="arrow" />}</button></div>
      <input hidden ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { void filesSelected(event.target.files); event.target.value = ""; }} />
      {error && <p className={styles.error} role="alert">{error}</p>}
    </form>
  </ReferenceContext.Provider></EmitterContext.Provider>;
}
