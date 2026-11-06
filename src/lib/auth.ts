import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db/database.ts";

const baseURL = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;

export const auth = betterAuth({
  database: db,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  account: { storeAccountCookie: false },
  plugins: [nextCookies()],
  socialProviders: {
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
      scope: ["identify", "guilds"],
      prompt: "consent",
    },
  },
});
