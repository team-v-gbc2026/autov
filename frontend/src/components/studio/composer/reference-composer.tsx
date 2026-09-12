"use client";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { SuggestionProps } from "@tiptap/suggestion";
import type { Reference } from "@/lib/project-types";
import { ReferenceContext, ReferenceMention } from "./reference-mention";
import { encodeMention } from "./prompt-format";
import ReferencePicker from "./reference-picker";
import Tooltip from "@/components/ui/tooltip";
import Icon from "../icon";
import styles from "./composer.module.css";

export type ComposerHandle = { mention: (reference: Reference) => void; setText: (text: string) => void };
export default function ReferenceComposer({ ref, references, busy, saving, uploadFile, onSend, sendLabel = "Save prompt" }: {
  ref: Ref<ComposerHandle>; references: Reference[]; busy: boolean; saving: boolean;
  uploadFile: (file: File) => Promise<Reference>; onSend: (prompt: string, ids: string[]) => Promise<boolean>; sendLabel?: string;
}) {
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
    })],
    editorProps: { attributes: { role: "textbox", "aria-label": "Describe your effect. Type @ to mention a board reference.", "aria-multiline": "true", "data-placeholder": "Describe your effect... @ to reference" } },
    onUpdate: ({ editor }) => setHasText(!editor.isEmpty),
  });
  useEffect(() => { editor?.setEditable(!saving); }, [editor, saving]);
  function insert(reference: Reference) {
    editor?.chain().focus().insertContent([{ type: "mention", attrs: { id: reference.id, label: reference.name } }, { type: "text", text: " " }]).run();
  }
  useImperativeHandle(ref, () => ({ mention: insert, setText: text => { editor?.chain().focus().insertContent(text).run(); } }));
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
    if (!editor || editor.isEmpty || saving || busy || uploading) return;
    const ids = new Set<string>(); let invalid = false;
    editor.state.doc.descendants(node => {
      if (node.type.name !== "mention") return;
      if (node.attrs.status !== "ready" || !references.some(ref => ref.id === node.attrs.id)) invalid = true;
      else ids.add(node.attrs.id);
    });
    if (invalid) { setError("Retry or remove unavailable references before sending."); return; }
    if (ids.size > 8) { setError("Use up to 8 references per prompt."); return; }
    const text = editor.getText({ textSerializers: { mention: ({ node }) => encodeMention(node.attrs.id, references.find(ref => ref.id === node.attrs.id)?.name || node.attrs.label) } });
    if (text.length > 10000) { setError("Keep the prompt under 10,000 characters."); return; }
    setError("");
    if (await onSend(text, [...ids])) editor.commands.clearContent();
  }
  return <ReferenceContext.Provider value={{ references, retry: id => { void retry(id); } }}>
    <form className={`composer ${styles.composer}`} onSubmit={event => { event.preventDefault(); void send(); }}>
      {picker && <ReferencePicker items={picker.items} active={active} onSelect={reference => picker.command(reference)} />}
      <EditorContent editor={editor} className={styles.editor} />
      <div className="composer-toolbar"><div className={styles.tools}>
        <Tooltip content="Upload reference images" side="top"><button type="button" className="icon-button" disabled={saving || busy || uploading} aria-label="Upload reference images" onMouseDown={event => event.preventDefault()} onClick={() => fileInput.current?.click()}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8 12 7-7a3 3 0 0 1 4 4L9 19a5 5 0 0 1-7-7L12 2M6 14l9-9" /></svg></button></Tooltip>
        <Tooltip content="Choose from board" side="top"><button type="button" className="icon-button" aria-label="Choose from board" disabled={saving} onMouseDown={event => event.preventDefault()} onClick={() => editor?.chain().focus().insertContent(" @").run()}>@</button></Tooltip>
        <span role="status">{uploading ? "Uploading..." : saving ? "Saving..." : ""}</span>
      </div><button type="submit" className="send-button" disabled={!hasText || saving || busy || uploading} aria-label={sendLabel} title={sendLabel}><Icon name="arrow" /></button></div>
      <input hidden ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { void filesSelected(event.target.files); event.target.value = ""; }} />
      {error && <p className={styles.error} role="alert">{error}</p>}
    </form>
  </ReferenceContext.Provider>;
}
