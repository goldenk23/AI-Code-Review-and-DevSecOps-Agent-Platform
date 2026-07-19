// Material Symbols Outlined icon components.
// The font is loaded via CDN <link> in layout.tsx. Each icon is just a
// <span class="material-symbols-outlined">icon_name</span> -- the font
// renders the glyph from the text content. This matches the Stitch designs
// exactly (they use the same font + class names).
//
// Size is controlled via className (e.g. "text-[18px]" or "size-5").
// Color is inherited via currentColor.

type IconProps = { className?: string; "aria-label"?: string };

function Icon({ name, className, "aria-label": label }: IconProps & { name: string }) {
  return (
    <span
      className={`material-symbols-outlined ${className ?? ""}`}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {name}
    </span>
  );
}

export const RefreshIcon = (p: IconProps) => <Icon name="refresh" {...p} />;
export const CommitIcon = (p: IconProps) => <Icon name="commit" {...p} />;
export const ChevronRightIcon = (p: IconProps) => <Icon name="chevron_right" {...p} />;
export const CommentIcon = (p: IconProps) => <Icon name="comment" {...p} />;
export const DescriptionIcon = (p: IconProps) => <Icon name="description" {...p} />;
export const TerminalIcon = (p: IconProps) => <Icon name="terminal" {...p} />;
export const CheckCircleIcon = (p: IconProps) => <Icon name="check_circle" {...p} />;
export const PlayIcon = (p: IconProps) => <Icon name="play_arrow" {...p} />;
export const AccountCircleIcon = (p: IconProps) => <Icon name="account_circle" {...p} />;
export const LogoutIcon = (p: IconProps) => <Icon name="logout" {...p} />;
export const WarningIcon = (p: IconProps) => <Icon name="warning" {...p} />;
export const TriangleIcon = (p: IconProps) => <Icon name="change_history" {...p} />;
export const SquareIcon = (p: IconProps) => <Icon name="square" {...p} />;
export const DiamondIcon = (p: IconProps) => <Icon name="diamond" {...p} />;
export const CircleIcon = (p: IconProps) => <Icon name="circle" {...p} />;
export const DotIcon = (p: IconProps) => <Icon name="fiber_manual_record" {...p} />;
export const ArrowForwardIcon = (p: IconProps) => <Icon name="arrow_forward" {...p} />;
export const SearchIcon = (p: IconProps) => <Icon name="search" {...p} />;
export const SettingsIcon = (p: IconProps) => <Icon name="settings" {...p} />;
export const NotificationsIcon = (p: IconProps) => <Icon name="notifications" {...p} />;
export const ShieldIcon = (p: IconProps) => <Icon name="shield" {...p} />;
export const FolderIcon = (p: IconProps) => <Icon name="folder" {...p} />;
export const FolderCopyIcon = (p: IconProps) => <Icon name="folder_copy" {...p} />;
export const FolderOpenIcon = (p: IconProps) => <Icon name="folder_open" {...p} />;
export const BoltIcon = (p: IconProps) => <Icon name="bolt" {...p} />;
export const GavelIcon = (p: IconProps) => <Icon name="gavel" {...p} />;
export const PsychologyIcon = (p: IconProps) => <Icon name="psychology" {...p} />;
export const IntegrationIcon = (p: IconProps) => <Icon name="integration_instructions" {...p} />;
export const CodeIcon = (p: IconProps) => <Icon name="code" {...p} />;
export const FilterListIcon = (p: IconProps) => <Icon name="filter_list" {...p} />;
export const AddIcon = (p: IconProps) => <Icon name="add" {...p} />;
export const MergeTypeIcon = (p: IconProps) => <Icon name="merge_type" {...p} />;
export const GridViewIcon = (p: IconProps) => <Icon name="grid_view" {...p} />;
export const ViewListIcon = (p: IconProps) => <Icon name="view_list" {...p} />;
export const WebhookIcon = (p: IconProps) => <Icon name="webhook" {...p} />;
export const StorageIcon = (p: IconProps) => <Icon name="storage" {...p} />;
export const TrendingUpIcon = (p: IconProps) => <Icon name="trending_up" {...p} />;
export const TrendingDownIcon = (p: IconProps) => <Icon name="trending_down" {...p} />;
export const ScheduleIcon = (p: IconProps) => <Icon name="schedule" {...p} />;
export const ErrorIcon = (p: IconProps) => <Icon name="error" {...p} />;
export const CheckIcon = (p: IconProps) => <Icon name="check" {...p} />;
export const MenuIcon = (p: IconProps) => <Icon name="menu" {...p} />;
export const CloseIcon = (p: IconProps) => <Icon name="close" {...p} />;

// GitHub mark -- kept as inline SVG since there's no Material Symbol for it.
export const GithubIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={p.className ?? "size-5"} aria-label={p["aria-label"]} role={p["aria-label"] ? "img" : undefined}>
    <path clipRule="evenodd" fillRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.379.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
  </svg>
);