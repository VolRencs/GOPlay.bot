"use client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  // Текущий origin: устаревший публичный URL не должен ронять cookie сессии.
});
