export default function Icon({
  name,
  size = 18,
}: {
  name: string;
  size?: number;
}) {
  const paths: Record<string, React.ReactNode> = {
    focus: <><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5" /><circle cx="12" cy="12" r="3" /></>,
    environment: <><path d="M3 16h18M5 20h14M7 12a5 5 0 0 1 10 0M12 2v2M4.9 4.9l1.4 1.4M19.1 4.9l-1.4 1.4M2 11h2M20 11h2" /></>,
    edit: <path d="m16 3 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-4-4L5 15l-1 5Z" />,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    tag: <path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16" />,
    plus: <path d="M12 5v14M5 12h14" />,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    solo: <><path d="m4 4 6-2 6 6-2 6-10-10ZM14 14l-3 7M16 12l5 3M16 16l4 4" /></>,
    "eye-off": <><path d="m3 3 18 18M10.5 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3.2 4.1M6.2 6.2A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.8-1.5M10 10a3 3 0 0 0 4 4" /></>,
    arrow: <path d="m7 14 5-5 5 5M12 9v11" />,
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
    upload: <path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    panel: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="3" />
        <path d="M9 4v16" />
      </>
    ),
    play: <path d="m9 5 11 7-11 7Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    reset: (
      <>
        <path d="M4 10a8 8 0 1 1 1 8M4 4v6h6" />
      </>
    ),
    loop: (
      <>
        <path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8" cy="8" r="1" />
        <path d="m3 17 5-5 4 4 4-6 5 7" />
      </>
    ),
    chevron: <path d="m8 10 4 4 4-4" />,
    sliders: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="2" />
        <circle cx="15" cy="17" r="2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.plus}
    </svg>
  );
}
