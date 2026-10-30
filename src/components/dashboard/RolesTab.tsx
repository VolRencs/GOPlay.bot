"use client";

import { AutoroleSettings } from "./AutorolePanel.tsx";
import { RoleSettings } from "./RolesPanel.tsx";

export function RolesTab() {
  return <section className="panel-stack">
    <AutoroleSettings/>
    <RoleSettings/>
  </section>;
}
