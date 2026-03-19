import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      {...props}
    />
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 6.5a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />
      <path d="M4 13h4l1.8 2h4.4L16 13h4" />
    </BaseIcon>
  );
}

export function ReportsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 19.5V8.5" />
      <path d="M12 19.5V4.5" />
      <path d="M19 19.5v-7" />
      <path d="M3.5 19.5h17" />
    </BaseIcon>
  );
}

export function AdvisorIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6.5 18.5 5 21l4-1.5a8 8 0 1 0-2.5-1z" />
      <path d="M9.5 11h5" />
      <path d="M9.5 14h3.5" />
      <path d="M9.5 8h5.5" />
    </BaseIcon>
  );
}

export function ControlIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 4.5v3" />
      <path d="M12 16.5v3" />
      <path d="M4.5 12h3" />
      <path d="M16.5 12h3" />
      <path d="m6.8 6.8 2.1 2.1" />
      <path d="m15.1 15.1 2.1 2.1" />
      <path d="m17.2 6.8-2.1 2.1" />
      <path d="m8.9 15.1-2.1 2.1" />
      <circle cx="12" cy="12" r="3.5" />
    </BaseIcon>
  );
}

export function CaptureIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4.5 8.5A2.5 2.5 0 0 1 7 6h1.8l1.2-1.5h4L15.2 6H17a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </BaseIcon>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2L6.5 8.5l4.2-1.3z" />
      <path d="m18.5 14.5.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z" />
      <path d="m5.5 14.5.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z" />
    </BaseIcon>
  );
}
