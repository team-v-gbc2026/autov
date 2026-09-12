import styles from "./chat-empty-state.module.css";

const prompts = [
  "A swirling cloud of silver particles",
  "A shockwave expanding into a ring of light",
  "Glowing embers drifting upward",
];

export default function ChatEmptyState({ onSelect, disabled = false }: {
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}) {
  return <div className={styles.empty}>
    <div className={styles.intro}>
      <span className="brand-symbol" aria-hidden="true">a</span>
      <h3>What will you create?</h3>
      <p>Describe an effect or try an idea below.</p>
    </div>
    <div className={styles.prompts} aria-label="Example prompts">
      {prompts.map(prompt => <button key={prompt} type="button" disabled={disabled} onClick={() => onSelect(prompt)}>
        <span>{prompt}</span><span className={styles.arrow} aria-hidden="true">↗</span>
      </button>)}
    </div>
  </div>;
}
