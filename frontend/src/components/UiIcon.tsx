import type { SVGProps } from "react";

export type UiIconName =
  | "activity"
  | "archive"
  | "blocks"
  | "check"
  | "chevron"
  | "close"
  | "expand"
  | "file"
  | "fit"
  | "flask"
  | "folder"
  | "info"
  | "database"
  | "error"
  | "more"
  | "play"
  | "arrange"
  | "save"
  | "search"
  | "settings"
  | "table"
  | "target"
  | "trash"
  | "warning";

interface UiIconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: UiIconName;
}

export function UiIcon({ name, className = "ui-icon", ...props }: UiIconProps) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
    ...props,
  };

  const paths: Record<UiIconName, JSX.Element> = {
    activity: <path d="M3 12h4l2.2-6 4.2 12 2.2-6H21" />,
    archive: (
      <>
        <path d="M4 7h16v13H4z" />
        <path d="M3 4h18v3H3zM9 11h6" />
      </>
    ),
    blocks: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="8.5" y="14" width="7" height="7" rx="1.5" />
        <path d="M6.5 10v2h11v-2M12 12v2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    expand: (
      <>
        <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
        <path d="m3 8 5-5m8 0 5 5m0 8-5 5M8 21l-5-5" />
      </>
    ),
    file: (
      <>
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v5h5M9 13h6M9 17h6" />
      </>
    ),
    fit: (
      <>
        <path d="M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5" />
      </>
    ),
    flask: (
      <>
        <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" />
        <path d="M7.5 15h9" />
      </>
    ),
    folder: (
      <path d="M3 6.5h7l2 2h9v10.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </>
    ),
    error: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m9 9 6 6m0-6-6 6" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7z" />,
    arrange: (
      <>
        <rect x="3" y="5" width="5" height="4" rx="1" />
        <rect x="16" y="5" width="5" height="4" rx="1" />
        <rect x="9.5" y="15" width="5" height="4" rx="1" />
        <path d="M8 7h8M12 7v8" />
      </>
    ),
    save: (
      <>
        <path d="M5 3h12l2 2v16H5z" />
        <path d="M8 3v6h8V3M8 21v-7h8v7" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    table: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="1.5" />
        <path d="M3 9h18M9 9v11M15 9v11M3 14h18" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 3h6l1 4H8zM6 7l1 14h10l1-14M10 11v6M14 11v6" />
      </>
    ),
    warning: (
      <>
        <path d="M10.3 4.2 2.7 18a2 2 0 0 0 1.8 3h15a2 2 0 0 0 1.8-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
  };

  return <svg {...common}>{paths[name]}</svg>;
}
