import { auth } from "../../../../src/lib/auth.ts";
import { toNextJsHandler } from "better-auth/next-js";
const { GET, POST } = toNextJsHandler(auth);
export { GET, POST };
