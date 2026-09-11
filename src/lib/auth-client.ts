"use client";
import { createAuthClient } from "better-auth/react";

// Без baseURL: берётся текущий origin — устаревший публичный URL не должен
// ронять cookie сессии.
export const authClient = createAuthClient();
