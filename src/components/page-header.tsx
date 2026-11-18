import type { ComponentProps, ComponentType, ReactNode } from "react";
import NextLink from "next/link.js";

const Link = NextLink as unknown as ComponentType<ComponentProps<"a">>;

type PageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  icon?: ReactNode;
  back?: { href: string; label: string };
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, description, icon, back, actions }: PageHeaderProps) {
  return <header className="page-header">
    {back && <Link className="back-link" href={back.href}>← {back.label}</Link>}
    <div className="page-header-row">
      {icon && <div className="page-icon">{icon}</div>}
      <div className="page-header-copy">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  </header>;
}
