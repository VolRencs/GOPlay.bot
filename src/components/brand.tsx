import NextLink from "next/link.js";
import type { ComponentProps, ComponentType } from "react";

const Link = NextLink as unknown as ComponentType<ComponentProps<"a">>;

export function Brand({ href = "/" }: { href?: string }) {
  return <Link className="brand" href={href}>
    <img src="/bot-logo.avif" alt="" width={32} height={32}/>
    <span>GOPlay</span>
  </Link>;
}
