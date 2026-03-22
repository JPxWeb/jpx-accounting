import type { ReactNode } from "react";

type SectionLabelProps = {
  children: ReactNode;
  as?: "p" | "span" | "div" | "label";
  htmlFor?: string;
};

export function SectionLabel({ children, as: Tag = "p", htmlFor }: SectionLabelProps) {
  return (
    <Tag className="text-eyebrow" htmlFor={htmlFor}>
      {children}
    </Tag>
  );
}
