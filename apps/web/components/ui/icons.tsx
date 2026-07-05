import {
  Bell,
  BookOpen,
  Camera,
  ChartNoAxesColumn,
  Inbox,
  MessageCircleQuestionMark,
  Search,
  Settings2,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";

/**
 * Single icon point for the app. Wraps lucide glyphs with the house 1.75 stroke
 * weight; everything else (className sizing via e.g. `size-4`, currentColor,
 * aria-hidden default) is standard lucide behavior. Add new icons here rather
 * than importing lucide-react directly in feature components.
 */
function make(Icon: LucideIcon) {
  function ConfiguredIcon(props: LucideProps) {
    return <Icon strokeWidth={1.75} {...props} />;
  }
  ConfiguredIcon.displayName = `Configured(${Icon.displayName ?? "Icon"})`;
  return ConfiguredIcon;
}

export const InboxIcon = make(Inbox);
export const CaptureIcon = make(Camera);
export const BooksIcon = make(BookOpen);
export const ReportsIcon = make(ChartNoAxesColumn);
export const ControlIcon = make(Settings2);
export const AdvisorIcon = make(MessageCircleQuestionMark);
export const SparkIcon = make(Sparkles);
export const SearchIcon = make(Search);
export const BellIcon = make(Bell);
export const UserIcon = make(UserRound);
