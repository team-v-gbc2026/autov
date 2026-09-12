import Icon from "./icon";
import type { ButtonHTMLAttributes } from "react";

export default function IconButton({
  name,
  label,
  active = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  name: string;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={name} />
    </button>
  );
}

export function iconButton(
  name: string,
  label: string,
  onClick: () => void,
  active = false,
) {
  return (
    <IconButton name={name} label={label} onClick={onClick} active={active} />
  );
}
