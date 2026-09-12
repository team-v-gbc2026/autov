import Icon from "./icon";

export default function PanelToggle({
  side,
  label,
  onOpen,
}: {
  side: "left" | "right";
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      className={`edge-panel-toggle edge-panel-${side}`}
      onClick={onOpen}
      aria-label={`Open ${label.toLowerCase()}`}
      title={`Open ${label.toLowerCase()}`}
    >
      <Icon name="panel" />
      <span>{label}</span>
    </button>
  );
}
