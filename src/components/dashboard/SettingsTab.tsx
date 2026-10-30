"use client";

import { BotLanguageCard } from "./BotLanguageCard.tsx";
import { ServerDataCleanup } from "./AuditPanel.tsx";

export function SettingsTab() {
  return <section className="panel-stack">
    <BotLanguageCard/>
    <ServerDataCleanup/>
  </section>;
}
